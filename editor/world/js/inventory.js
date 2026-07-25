// M4: L2-style inventory window. Grid from itemList/invUpdate + itemmeta
// (fallback names/icons while absent). Double-click uses an item; count
// badges; equipped marker; loot toast on additions.
//
// invUpdate change values: accepts L2 numerics (1 add, 2 modify, 3 remove)
// or strings 'add'|'modify'|'remove' (mock convenience).

import { itemMeta, itemInfo } from './gamedata.js';

const CHANGE = { 1: 'add', 2: 'modify', 3: 'remove' };

export class Inventory {
  constructor(panelEl, gridEl, toastEl, { onUse } = {}) {
    this.panel = panelEl;
    this.grid = gridEl;
    this.toast = toastEl;
    this.onUse = onUse || (() => {});
    this.items = new Map();    // objectId -> item
    this.meta = null;
    panelEl.querySelector('.inv-close').addEventListener('click', () => this.toggle(false));
  }

  toggle(force) {
    const show = force ?? !this.panel.classList.contains('visible');
    this.panel.classList.toggle('visible', show);
  }

  async setItems(items) {
    if (!this.meta) this.meta = await itemMeta();
    this.items.clear();
    for (const it of items) this.items.set(it.objectId, it);
    this.render();
  }

  async applyUpdate(updated) {
    if (!this.meta) this.meta = await itemMeta();
    for (const u of updated) {
      const change = CHANGE[u.change] || u.change;
      if (change === 'remove') this.items.delete(u.objectId);
      else {
        this.items.set(u.objectId, { ...(this.items.get(u.objectId) || {}), ...u });
        if (change === 'add') this.lootToast(u);
      }
    }
    this.render();
  }

  lootToast(item) {
    const info = itemInfo(this.meta, item.itemId);
    const el = document.createElement('div');
    el.className = 'loot-toast';
    el.textContent = `Looted: ${info.name}${item.count > 1 ? ' ×' + item.count : ''}`;
    this.toast.appendChild(el);
    setTimeout(() => el.classList.add('show'), 16);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 2600);
  }

  render() {
    this.grid.innerHTML = '';
    const items = [...this.items.values()].sort((a, b) => (b.equipped - a.equipped)
      || (a.slot ?? 0) - (b.slot ?? 0) || a.objectId - b.objectId);
    for (const it of items) {
      const info = itemInfo(this.meta, it.itemId);
      const el = document.createElement('div');
      el.className = 'inv-slot' + (it.equipped ? ' equipped' : '');
      el.dataset.oid = it.objectId;
      const enchant = it.enchant ? ` +${it.enchant}` : '';
      el.title = `${info.name}${enchant}${it.equipped ? ' (equipped)' : ''}`;
      el.innerHTML = (info.icon
        ? `<img src="${info.icon}" alt="">`
        : '<div class="icon-fallback">?</div>')
        + (it.count > 1 ? `<span class="count">${it.count}</span>` : '')
        + (it.equipped ? '<span class="eq">E</span>' : '');
      el.addEventListener('dblclick', () => this.onUse(it.objectId));
      // M5: hotbar assign — drag, or right-click for first free slot
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-l2vzla',
          JSON.stringify({ type: 'item', id: it.objectId }));
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.onAssign) this.onAssign({ type: 'item', id: it.objectId });
      });
      this.grid.appendChild(el);
    }
  }

  clear() {
    this.items.clear();
    this.render();
    this.toggle(false);
  }
}
