// Original Interface.u HennaListWnd/HennaInfoWnd, with server-owned values.
// Source metadata: tools/ui/mine_henna.py (private output). Browser glyph
// measurement, inherited text flags, frame/button states, selection texture
// placement and browser tooltip painting still have native parity gaps.
import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout, sourceControls } from './layout.js';
import { L2Window } from './window.js';
import { defaultWindowPosition } from './windowposition.js';
import { trainingRects, trainingRow } from './skilltrainwnd.js';
import { groupDialogDigits, dialogDigitColor, readDialogDigits } from './dialogbox.js';
import { itemMeta, itemInfo } from '../gamedata.js';
import { Henna, HENNA_STATS } from '../henna.js';

const LIST = 'HennaListWnd', INFO = 'HennaInfoWnd';
const colorPattern = /^#[0-9a-f]{6}$/i;

// Repeated txtArrow siblings are distinct original records. Give only their
// internal layout keys occurrence suffixes; never discard five via Map.set.
export function hennaControls(root, mode) {
  return sourceControls(root, [mode === 'equip' ? 'HennaInfoWndUnEquip' : 'HennaInfoWndEquip']);
}

function place(el, r) {
  Object.assign(el.style, { position: 'absolute', left: `${Skin.px(r.x)}px`, top: `${Skin.px(r.y)}px`,
    width: `${Skin.px(r.width)}px`, height: `${Skin.px(r.height)}px` });
}
function paint(el, reference) {
  if (!reference || !Skin.sprite(reference)) throw new Error(`Original henna artwork unavailable: ${reference}`);
  Skin.apply(el, reference);
}
function image(el, url) {
  if (!url) throw new Error('Original henna icon unavailable');
  el.style.backgroundImage = `url("${url}")`; el.style.backgroundSize = '100% 100%';
}
function write(el, text, color, align = 'left') {
  if (!colorPattern.test(color)) throw new Error('Original henna text color unavailable');
  el.dataset.text = text; el.setAttribute('aria-label', text);
  el.style.textAlign = align; el.style.overflow = 'hidden';
  Font.set(el, text, { color });
}

export class HennaWnd {
  constructor(parent = document.body, { send, listArgument, loadMetadata } = {}) {
    this.parent = parent; this.windows = {}; this.lastError = null;
    this.state = new Henna({ send, listArgument, changed: () => this.render() });
    const read = loadMetadata || (async () => {
      const json = async path => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Original henna metadata unavailable: ${path}`);
        return response.json();
      };
      const [data, items, dialog] = await Promise.all([
        json('/gamedata/henna.json'), itemMeta(), json('/gamedata/dialogbox.json'),
      ]);
      return { data, items, dialog };
    });
    this.ready = Promise.resolve().then(read).then(({ data, items, dialog }) => {
      const edit = dialog?.controls?.DialogBoxEdit;
      if (data?.format !== 'l2-interlude-henna-v1' || data.nativeLayoutProof?.status !== 'verified'
          || data.nativeTreeFlow?.status !== 'verified-static-original' || !Array.isArray(data.records)
          || !items || !colorPattern.test(edit?.color)
          || edit.numberColor?.minimumDigits !== 5 || edit.numberColor?.indexSubtract !== 2
          || edit.numberColor?.colors?.length !== 4 || edit.numberColor.colors.some(c => !colorPattern.test(c)))
        throw new Error('Original henna layout or numeric-color contract unavailable');
      this.data = data; this.items = items; this.numberStyle = edit;
      this.numberReading = dialog.numberPad?.native?.reading;
      for (const name of [LIST, INFO]) {
        const source = data.windows[name], p = source?.position;
        if (!source || !p || p.target || p.selfAnchor !== p.targetAnchor)
          throw new Error(`Original henna creation anchor unavailable: ${name}`);
        const rect = { x: 0, y: 0, width: source.width, height: source.height };
        const origin = defaultWindowPosition({ anchor: p.selfAnchor, anchored: true,
          offsetX: p.offsetX, offsetY: p.offsetY }, rect,
        { x: 0, y: 0, width: window.innerWidth / Skin.scale, height: window.innerHeight / Skin.scale });
        if (!origin) throw new Error(`Invalid original henna window: ${name}`);
        const win = new L2Window({ title: '', width: source.width, height: source.height,
          winName: name, nativeBounds: true, back: 'none' });
        win.root.id = `l2-${name}`; win.root.setAttribute('role', 'dialog');
        win.place({ left: origin.x, top: origin.y }); win.onClose = () => this.state.close();
        parent.appendChild(win.root); this.windows[name] = win;
      }
      this.render(); return this;
    }).catch(error => { this.lastError = error; console.error('HennaWnd:', error); return this; });
  }

  reset() { this.state.reset(); }
  list(mode, message) { return this.state.list(mode, message); }
  details(mode, message) { return this.state.details(mode, message); }
  update(message) { return this.state.update(message); }
  label(id) {
    const value = this.data.strings[id];
    if (typeof value !== 'string') throw new Error(`Original henna label ${id} unavailable`);
    return value;
  }
  money(value) {
    const digits = String(value), grouped = groupDialogDigits(digits);
    if (!Number.isInteger(value) || grouped === null) throw new Error('Unsupported henna money representation');
    return { text: grouped, color: dialogDigitColor(digits, this.numberStyle) };
  }
  moneyTooltip(value) {
    const proof = this.data.native?.numericText, reading = this.numberReading;
    if (proof?.status !== 'verified-english-wrapper' || reading?.status !== 'verified-english'
        || !Array.isArray(reading.labels) || reading.labels.length !== 3
        || proof.suffixSysStringId !== 469 || proof.maximumMagnitudeDigits !== 12
        || proof.suffixSeparator !== ' ') return null;
    const digits = String(value), text = readDialogDigits(digits, reading.labels);
    if (text === null) return null;
    // ConvertNumToText's early zero/long paths bypass the suffix. The normal
    // and cached paths keep the base helper's whitespace before adding a space.
    return text && digits.length <= proof.maximumMagnitudeDigits
      ? text + proof.suffixSeparator + this.label(proof.suffixSysStringId) : text;
  }
  tattoo(id) {
    const source = this.data.records.find(r => r.symbolId === id);
    const file = this.data.icons[source?.icon]?.file;
    if (!source || typeof source.name !== 'string' || typeof source.text2 !== 'string' || !file)
      throw new Error(`Original symbol metadata unavailable: ${id}`);
    return { ...source, iconUrl: `/gamedata/${file}` };
  }
  dye(id) {
    if (!this.items[id]?.name || !this.items[id]?.icon) throw new Error(`Original dye metadata unavailable: ${id}`);
    return itemInfo(this.items, id);
  }

  render() {
    if (!this.state || !this.data || !this.windows[INFO]) return;
    const active = this.state.view === 'list' ? LIST : this.state.view === 'info' ? INFO : null;
    for (const [name, win] of Object.entries(this.windows)) if (name !== active) win.hide();
    if (!active) return;
    try {
      this.renderWindow(active); this.windows[active].show(); this.lastError = null;
    } catch (error) {
      this.windows[active].hide(); this.lastError = error; console.error('HennaWnd:', error);
    }
  }

  renderWindow(name) {
    const win = this.windows[name], mode = this.state.mode;
    const { root, entries } = hennaControls(this.data.windows[name], mode);
    const text = new Map(), colors = new Map(), icons = new Map();
    for (const { node, path } of entries)
      text.set(path, node.textId != null ? this.label(node.textId) : node.textLayout?.defaultText || '');
    const set = (control, value, color) => {
      const matches = entries.filter(e => e.node.sourceName === control);
      if (matches.length !== 1) throw new Error(`Ambiguous/missing henna control ${control}`);
      text.set(matches[0].path, String(value));
      if (color) colors.set(matches[0].path, color);
    };
    const icon = (control, url) => {
      const found = entries.find(e => e.node.sourceName === control);
      if (!found) throw new Error(`Missing henna icon control ${control}`);
      icons.set(found.path, url);
    };
    const title = this.label(mode === 'equip' ? 651 : 652);
    win.setTitle(title); win.root.setAttribute('aria-label', title);
    if (name === LIST) {
      set('txtList', this.label(mode === 'equip' ? 659 : 660));
      set('txtAdena', this.money(this.state.adena).text); // Script does not recolor owned Adena.
    } else {
      const packet = this.state.info, dye = this.dye(packet.dyeId), tattoo = this.tattoo(packet.symbolId);
      const suffix = mode === 'equip' ? '' : 'UnEquip', fee = this.money(packet.price);
      set(`txtDyeInfo${suffix}`, this.label(638)); set(`txtDyeName${suffix}`, dye.name);
      icon(`textureDyeIconName${suffix}`, dye.icon);
      set(`txtTattooInfo${suffix}`, this.label(639));
      set(`txtTattooName${suffix}`, mode === 'equip' ? tattoo.name : `${this.label(652)}:${tattoo.name}`);
      set(`txtTattooAddName${suffix}`, tattoo.text2); icon(`textureTattooIconName${suffix}`, tattoo.iconUrl);
      set(`txtFee${suffix}`, `${this.label(637)} : `, '#A8A8A8');
      set(`txtAdena${suffix}`, fee.text, fee.color); set(`txtAdenaString${suffix}`, this.label(469), '#FFFF00');
      for (const stat of HENNA_STATS) {
        set(`txt${stat}Before`, packet.stats[stat].current); set(`txt${stat}After`, packet.stats[stat].after);
      }
      set('txtHaveAdena', this.money(packet.adena).text); // Computed color is not applied by original script.
    }
    const rects = trainingRects(root, text, t => Font.measure(t), Font.lineHeight());
    win.body.replaceChildren();
    const back = document.createElement('div'); place(back, rects.get(name)); paint(back, root.textures[0]);
    win.body.appendChild(back);
    for (const { node, path } of entries) {
      if (node.type === 'Window') continue;
      const rect = rects.get(path), el = document.createElement(node.type === 'Button' ? 'button' : 'div');
      el.dataset.control = node.sourceName; el.dataset.sourcePath = path;
      place(el, rect); win.body.appendChild(el);
      if (node.type === 'TextBox') {
        write(el, text.get(path), colors.get(path) || node.color || Layout.native('textBoxDefault'), node.align);
        if ((name === LIST && node.sourceName === 'txtAdena') || (name === INFO && node.sourceName === 'txtHaveAdena')) {
          const tooltip = this.moneyTooltip(name === LIST ? this.state.adena : this.state.info.adena);
          // Original SetTooltipString text on a browser title. This does not
          // claim the browser's tooltip box or timing matches native drawing.
          if (tooltip !== null) el.title = tooltip;
        }
      }
      else if (node.type === 'Texture') icons.has(path) ? image(el, icons.get(path)) : paint(el, node.textures[0]);
      else if (node.type === 'TreeCtrl') this.renderList(el);
      else if (node.type === 'Button') {
        const detail = this.state.info;
        el.type = 'button'; el.style.cssText += ';border:0;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center';
        paint(el, node.textures[0]); write(el, text.get(path), Layout.native('buttonLabel'));
        el.addEventListener('click', () => {
          if (this.state.info !== detail || this.state.view !== 'info') return;
          if (node.sourceName === 'btnOK') this.state.confirm();
          else if (node.sourceName === 'btnPrev') this.state.back();
        });
      }
    }
  }

  renderList(parent) {
    parent.style.overflowY = 'auto';
    const mode = this.state.mode, rows = this.state.items;
    const content = document.createElement('div');
    // HennaListRoot source offset(7,-3); children use native cursor flow.
    content.style.cssText = `position:relative;top:${Skin.px(-3)}px`; parent.appendChild(content);
    for (const row of rows) {
      const record = mode === 'equip' ? this.dye(row.dyeId) : this.tattoo(row.symbolId);
      const fee = this.money(row.price), feeY = mode === 'equip' ? -13 : -12;
      const items = [
        { url: record.iconUrl || record.icon, width: 32, height: 32, x: 0, y: 15 },
        { text: record.name, x: 5, y: mode === 'equip' ? 17 : 10 },
        ...(mode === 'unequip' ? [{ text: record.text2, x: 37, y: -24, break: true }] : []),
        { text: `${this.label(637)} : `, x: 37, y: feeY, break: true, color: '#A8A8A8' },
        { text: fee.text, x: 0, y: feeY, color: fee.color },
        { text: this.label(469), x: 5, y: feeY, color: '#FFFF00' },
      ];
      const flow = trainingRow(items, 7, item => item.text == null
        ? { width: item.width, height: item.height }
        : { width: Font.measure(item.text), height: Font.lineHeight() });
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.symbolId = row.symbolId; button.setAttribute('aria-label', record.name);
      button.style.cssText = `display:block;position:relative;width:100%;height:${Skin.px(flow.height)}px;`
        + 'margin:0;padding:0;border:0;background:none;text-align:left;cursor:pointer;overflow:hidden';
      for (const placed of flow.placed) {
        const el = document.createElement('span'); place(el, placed); button.appendChild(el);
        if (placed.item.text == null) image(el, placed.item.url);
        else write(el, placed.item.text, placed.item.color || Layout.native('textBoxDefault'));
      }
      button.addEventListener('click', () => {
        if (this.state.items === rows && this.state.mode === mode) this.state.select(row.symbolId);
      });
      content.appendChild(button);
    }
  }
}
