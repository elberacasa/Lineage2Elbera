// Original HennaListWnd/HennaInfoWnd and InventoryWnd.UpdateHennaInfo.
// Server snapshots own symbols, money and stats. This controller changes only
// window state and requests; it never applies a tattoo or deducts an item.
const integer = n => Number.isInteger(n) && n >= -0x80000000 && n <= 0x7fffffff;
const symbol = n => integer(n) && n > 0;
const modes = new Set(['equip', 'unequip']);
export const HENNA_STATS = ['INT', 'STR', 'CON', 'MEN', 'DEX', 'WIT'];
const byte = n => Number.isInteger(n) && n >= 0 && n <= 255;
const row = r => r && symbol(r.symbolId)
  && ['dyeId', 'amount', 'price', 'unknown'].every(k => integer(r[k]));

export function inventoryHenna(snapshot, classId, data) {
  const step = data?.native?.classSteps?.[classId];
  const rows = [1, 2, 3].includes(step) ? step : 0;
  const records = new Map((data?.records || []).map(r => [r.symbolId, r]));
  const items = [];
  for (const entry of (snapshot?.symbols || []).slice(0, rows)) {
    const source = records.get(entry.symbolId);
    // Original script breaks at the first unresolved name/description/icon.
    if (!source || !['name', 'text1', 'icon'].every(k => typeof source[k] === 'string')) break;
    items.push({ ...entry, source, disabled: entry.usableSymbolId === 0 });
  }
  return { rows, items };
}

export class Henna {
  constructor({ send = () => false, changed = () => {}, listArgument = () => null } = {}) {
    this.send = send; this.changed = changed; this.listArgument = listArgument;
    this.reset();
  }
  reset() {
    this.snapshot = null; this.mode = null; this.view = null;
    this.items = []; this.info = null; this.requested = null; this.adena = null;
    this.changed(this);
  }
  update(message) {
    if (!message || !integer(message.maxSlots) || !Array.isArray(message.symbols)
        || !HENNA_STATS.every(k => byte(message.statBytes?.[k]))
        || !message.symbols.every(s => symbol(s.symbolId) && integer(s.usableSymbolId))) return false;
    this.snapshot = { maxSlots: message.maxSlots, statBytes: { ...message.statBytes },
      symbols: message.symbols.map(s => ({ ...s })) };
    this.changed(this); return true;
  }
  list(mode, message) {
    if (!modes.has(mode) || !message || !integer(message.adena)
        || !Array.isArray(message.items) || !message.items.every(row)) return false;
    this.mode = mode; this.adena = message.adena;
    this.items = message.items.map(r => ({ ...r }));
    this.info = null; this.requested = null; this.view = 'list';
    this.changed(this); return true;
  }
  select(symbolId) {
    if (this.view !== 'list' || !this.items.some(r => r.symbolId === symbolId)) return false;
    const op = this.mode === 'equip' ? 'hennaItemInfo' : 'hennaUnequipInfo';
    if (!this.send(op, { symbolId })) return false;
    this.requested = { mode: this.mode, symbolId };
    // Original list remains visible until ShowHennaInfoWnd hides it.
    return true;
  }
  details(mode, message) {
    if (!this.requested || mode !== this.requested.mode || message?.symbolId !== this.requested.symbolId
        || !row(message) || !integer(message.adena)
        || !HENNA_STATS.every(k => integer(message.stats?.[k]?.current)
          && byte(message.stats?.[k]?.after))) return false;
    this.info = { ...message, stats: Object.fromEntries(HENNA_STATS.map(k => [k, { ...message.stats[k] }])) };
    this.requested = null; this.view = 'info';
    this.changed(this); return true;
  }
  confirm() {
    if (this.view !== 'info') return false;
    const op = this.mode === 'equip' ? 'hennaEquip' : 'hennaUnequip';
    const request = { symbolId: this.info.symbolId };
    this.close();
    return this.send(op, request);
  }
  back() {
    if (this.view !== 'info') return false;
    const op = this.mode === 'equip' ? 'hennaEquipList' : 'hennaUnequipList';
    const unknown = this.listArgument(this.mode);
    this.close();
    // Do not invent the extra DWORD used by the original list request.
    if (!integer(unknown)) return false;
    return this.send(op, { unknown });
  }
  close() {
    this.view = null; this.requested = null; this.info = null;
    this.changed(this);
  }
}
