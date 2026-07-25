// M5: 10-slot hotbar for skills AND usable items, below the skill
// palette. Assign by drag&drop from the skill bar / inventory, or
// right-click a source to assign to the first free slot; right-click a
// hotbar slot to clear it. Click or Digit1..0 triggers useSkill/useItem.
// Persisted per character name in localStorage.

import { skillMeta, skillInfo, itemMeta, itemInfo } from './gamedata.js';

const SLOTS = 10;

export class Hotbar {
  constructor(rootEl, { onTrigger, getCharName } = {}) {
    this.root = rootEl;
    this.onTrigger = onTrigger || (() => {});
    this.getCharName = getCharName || (() => 'default');
    this.slots = new Array(SLOTS).fill(null);   // {type:'skill'|'item', id}
    this.els = [];
    this._build();
  }

  _key() { return `l2vzla.hotbar.${this.getCharName()}`; }

  _build() {
    this.root.innerHTML = '';
    this.els = [];
    for (let i = 0; i < SLOTS; i++) {
      const el = document.createElement('div');
      el.className = 'hot-slot empty';
      el.dataset.index = i;
      el.innerHTML = `<span class="slot-key">${(i + 1) % 10}</span>`;
      el.addEventListener('click', () => this.trigger(i));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.assign(i, null); });
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        try {
          const data = JSON.parse(e.dataTransfer.getData('application/x-l2vzla'));
          this.assign(i, data);
        } catch { /* not ours */ }
      });
      this.root.appendChild(el);
      this.els.push(el);
    }
  }

  async render() {
    const [sm, im] = await Promise.all([skillMeta(), itemMeta()]);
    for (let i = 0; i < SLOTS; i++) {
      const s = this.slots[i];
      const el = this.els[i];
      const key = el.querySelector('.slot-key').outerHTML;
      if (!s) {
        el.className = 'hot-slot empty';
        el.innerHTML = key;
        el.title = '';
        continue;
      }
      const info = s.type === 'skill' ? skillInfo(sm, s.id) : itemInfo(im, s.id);
      el.className = 'hot-slot';
      el.innerHTML = (info.icon ? `<img src="${info.icon}" alt="">`
        : '<div class="icon-fallback">?</div>') + key;
      el.title = info.name + ` [${(i + 1) % 10}]`;
    }
  }

  assign(i, data) {
    this.slots[i] = data;   // null clears
    this.render();
    try { localStorage.setItem(this._key(), JSON.stringify(this.slots)); } catch {}
  }

  assignFirstFree(data) {
    const i = this.slots.findIndex(s => s === null);
    if (i >= 0) this.assign(i, data);
    return i;
  }

  trigger(i) {
    const s = this.slots[i];
    if (s) this.onTrigger(s, i);
  }

  load() {
    try {
      const raw = localStorage.getItem(this._key());
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr)) {
        this.slots = arr.slice(0, SLOTS).map(s =>
          (s && (s.type === 'skill' || s.type === 'item')) ? s : null);
        while (this.slots.length < SLOTS) this.slots.push(null);
      }
    } catch { /* fresh bar */ }
    this.render();
  }

  clear() {
    this.slots = new Array(SLOTS).fill(null);
    this.render();
  }
}

// drag helpers for source elements (skill palette slots, inventory slots)
export function makeDraggable(el, data) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-l2vzla', JSON.stringify(data));
  });
}
