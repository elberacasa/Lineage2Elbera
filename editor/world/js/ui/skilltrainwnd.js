// Original SkillTrainListWnd / SkillTrainInfoWnd. Native packet and layout
// evidence: docs/native-skilltraining-evidence.md. Enchantment has a separate
// protocol and is not passed through normal acquisition.
import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout } from './layout.js';
import { L2Window } from './window.js';
import { skillMeta, skillInfo, itemMeta, itemInfo, sysStringMeta } from '../gamedata.js';
import { SkillTraining } from '../skilltraining.js';

const LIST = 'SkillTrainListWnd', INFO = 'SkillTrainInfoWnd';

function flatten(root) {
  const nodes = [];
  const visit = (node, parent, path) => {
    if (node.name === 'SubWndEnchant') return;
    nodes.push({ node, parent, path });
    for (const child of node.children || []) visit(child, path, `${path}.${child.name}`);
  };
  visit(root, null, root.name);
  return nodes;
}

function anchor(rect, value) {
  if (!Number.isInteger(value) || value < 1 || value > 9) throw new Error('unresolved native anchor');
  // Native conversion truncates each absolute anchor point independently.
  const i = value - 1;
  return { x: Math.trunc(rect.x + (i % 3) * rect.width / 2),
    y: Math.trunc(rect.y + Math.floor(i / 3) * rect.height / 2) };
}

/** Source anchor solver for these two windows. Alias resolution is a browser
 * adaptation: a missing intermediate window may resolve only to a unique
 * active control. Native general name lookup remains a documented gap. */
export function trainingRects(root, text, measure, lineHeight) {
  const entries = flatten(root), byPath = new Map(entries.map(e => [e.path, e]));
  const result = new Map([[root.name, { x: 0, y: 0, width: root.width, height: root.height }]]);
  const visiting = new Set();
  const lookup = path => {
    if (byPath.has(path)) return path;
    const leaf = path.split('.').at(-1);
    const matches = entries.filter(e => e.node.name === leaf);
    if (matches.length !== 1) throw new Error(`unresolved trainer anchor ${path}`);
    return matches[0].path;
  };
  const solve = path => {
    if (result.has(path)) return result.get(path);
    if (visiting.has(path)) throw new Error(`cyclic trainer anchor ${path}`);
    visiting.add(path);
    const { node, parent } = byPath.get(path), p = node.position;
    if (!p || node.sizeMode !== 'absolute') throw new Error(`unresolved trainer geometry ${path}`);
    let { width, height } = node;
    if (node.type === 'TextBox' && node.textLayout?.autoSize === 1) {
      width = measure(text.get(path) ?? '') + 1;
      height = lineHeight;
    }
    if (![width, height].every(Number.isFinite)) throw new Error(`invalid trainer dimensions ${path}`);
    const target = solve(p.target ? lookup(p.target) : parent);
    const to = anchor(target, p.targetAnchor), own = anchor({ x: 0, y: 0, width, height }, p.selfAnchor);
    const rect = { x: to.x - own.x + p.offsetX, y: to.y - own.y + p.offsetY, width, height };
    result.set(path, rect); visiting.delete(path);
    return rect;
  };
  for (const entry of entries) solve(entry.path);
  return result;
}

/** NCXMLTree::DrawTreeNode cursor flow. Item extents are supplied by the
 * texture/text renderer, so wrapped text can increase the row height. */
export function trainingRow(items, originX, extent) {
  let x = originX, y = 0, lineHeight = 0, height = 0;
  const placed = [];
  for (const item of items) {
    if (item.break) { x = originX + item.x; y += lineHeight; height += lineHeight; lineHeight = 0; }
    else x += item.x;
    const size = extent(item, x);
    placed.push({ item, ...size, x, y: y + item.y });
    x += size.width;
    lineHeight = Math.max(lineHeight, size.height + item.y);
  }
  return { placed, height: height + lineHeight };
}

function place(el, r) {
  Object.assign(el.style, { position: 'absolute', left: `${Skin.px(r.x)}px`, top: `${Skin.px(r.y)}px`,
    width: `${Skin.px(r.width)}px`, height: `${Skin.px(r.height)}px` });
}

// Browser line wrapping uses the original glyph atlas. Native NCTextBox
// wrapping/measurement parity is still unverified, not an invented text font.
function write(el, text, node, width) {
  el.setAttribute('aria-label', text);
  el.dataset.text = text;
  const color = node.color || Layout.native('textBoxDefault');
  const lines = [];
  for (const paragraph of text.split(/\\n|\n/)) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (node.textLayout?.autoSize !== 1 && line && Font.measure(candidate) > width) {
        lines.push(line); line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  el.style.textAlign = node.align || 'left';
  el.style.overflow = 'hidden';
  for (const text of lines) {
    const line = document.createElement('div');
    line.style.height = `${Skin.px(Font.lineHeight())}px`;
    Font.set(line, text, { color });
    el.appendChild(line);
  }
}

export class SkillTrainWnd {
  constructor(parent = document.body, { send, getPlayer = () => ({}), loadMetadata } = {}) {
    this.parent = parent;
    this.getPlayer = getPlayer;
    this.windows = {};
    this.lastError = null;
    this.state = new SkillTraining({ send, changed: () => this.render() });
    const read = loadMetadata || (async () => {
      const response = await fetch('/gamedata/skilltraining.json');
      if (!response.ok) throw new Error('Original skill-training layout is unavailable');
      const [data, skills, items, labels] = await Promise.all([response.json(), skillMeta(), itemMeta(), sysStringMeta()]);
      return { data, skills, items, labels };
    });
    this.ready = read().then(({ data, skills, items, labels }) => {
      if (data?.schema !== 1 || data.geometry?.sourceDimensions !== 'total native rectangle')
        throw new Error('Original skill-training source contract is unavailable');
      this.data = data; this.skills = skills; this.items = items;
      this.skillLabels = Array.isArray(labels)
        ? Object.fromEntries(labels.map(row => [row.id, row.string])) : labels || {};
      for (const name of [LIST, INFO]) {
        const source = data.windows[name];
        if (!source?.width || !source?.height) throw new Error(`Missing source window ${name}`);
        const win = new L2Window({ title: '', width: source.width, height: source.height,
          winName: name, nativeBounds: true, back: 'none' });
        win.root.id = `l2-${name}`;
        win.root.setAttribute('role', 'dialog');
        // Source center-to-center anchor; a user drag may override it later.
        const viewportCenter = anchor({ x: 0, y: 0,
          width: window.innerWidth / Skin.scale, height: window.innerHeight / Skin.scale }, 5);
        const sourceCenter = anchor({ x: 0, y: 0, width: source.width, height: source.height }, 5);
        win.place({ left: viewportCenter.x - sourceCenter.x, top: viewportCenter.y - sourceCenter.y });
        win.onClose = () => this.state.close();
        parent.appendChild(win.root); this.windows[name] = win;
      }
      this.render();
      return this;
    }).catch(error => { this.lastError = error; console.error('SkillTrainWnd:', error); return this; });
  }

  reset() { this.state.reset(); }
  list(message) { return this.state.list(message); }
  details(message) { return this.state.details(message); }
  done() { this.state.done(); }

  render() {
    if (!this.data || !this.windows[INFO]) return;
    const active = this.state.view === 'list' ? LIST : this.state.view === 'info' ? INFO : null;
    for (const [name, win] of Object.entries(this.windows)) {
      if (name !== active) win.hide();
    }
    if (!active) return;
    try {
      this.renderWindow(active);
      this.windows[active].show();
      this.lastError = null;
    } catch (error) {
      this.windows[active].hide(); this.lastError = error;
      console.error('SkillTrainWnd:', error);
    }
  }

  renderWindow(name) {
    const win = this.windows[name], root = this.data.windows[name], entries = flatten(root);
    const strings = this.data.strings, text = new Map(), textures = new Map(), hidden = new Set();
    const value = (id) => strings[id] ?? '';
    const set = (control, content) => text.set(`${name}.${control}`, String(content ?? ''));
    const title = value(this.state.type === 2 ? 1436 : 477);
    win.setTitle(title); win.root.setAttribute('aria-label', title);
    for (const { node, path } of entries) {
      text.set(path, node.textId != null ? value(node.textId) : (node.textLayout?.defaultText || ''));
    }
    const player = this.getPlayer() || {};
    const resource = this.state.type === 2 ? player.clanReputation : player.sp;
    set('txtSP', resource);
    if (name === LIST) set('txtSPString', value(this.state.type === 2 ? 1372 : 92));
    if (name === INFO) {
      const packet = this.state.info, skill = skillInfo(this.skills, packet.id, packet.level);
      set('txtName', skill.name);
      set('SubWndNormal.txtLevel', packet.level);
      const operateLabel = this.skillLabels[skill.displayTypeId];
      set('SubWndNormal.txtOperateType', typeof operateLabel === 'string' ? operateLabel : operateLabel?.string);
      set('SubWndNormal.txtMP', skill.mp);
      const range = skill.range;
      set('SubWndNormal.txtCastRange', range);
      if (range == null || range < 0)
        for (const leaf of ['txtCastRangeString', 'txtColoneCastRange', 'txtCastRange']) hidden.add(`${name}.SubWndNormal.${leaf}`);
      set('SubWndNormal.txtDescription', skill.desc || '');
      set('SubWndNormal.txtNeedSPString', value(this.state.type === 2 ? 1437 : 365));
      set('SubWndNormal.txtNeedSP', packet.cost);
      set('SubWndNormal.txtSPString', value(this.state.type === 2 ? 1372 : 92));
      textures.set(`${name}.texIcon`, skill.icon);
      // Each native AddExtendInfo updates the same controls, in wire order.
      // Keep every requirement in state; the original view displays the last.
      const requirement = packet.requirements.at(-1);
      if (requirement) {
        const item = itemInfo(this.items, requirement.itemId);
        textures.set(`${name}.SubWndNormal.texNeedItemIcon`, item.icon);
        set('SubWndNormal.txtNeedItemName', `${item.name} X ${requirement.count}`);
      } else {
        hidden.add(`${name}.SubWndNormal.texNeedItemIcon`);
        hidden.add(`${name}.SubWndNormal.txtNeedItemName`);
      }
    }
    const rects = trainingRects(root, text, t => Font.measure(t), Font.lineHeight());
    win.body.replaceChildren();
    if (name === LIST) {
      const background = document.createElement('div');
      place(background, rects.get(name)); Skin.apply(background, root.textures[0]);
      win.body.appendChild(background);
    }
    // The native background lies under controls regardless of record order.
    const ordered = entries.filter(e => e.parent).sort((a, b) =>
      Number(b.node.name === 'texBack') - Number(a.node.name === 'texBack'));
    for (const { node, path } of ordered) {
      if (node.type === 'Window' || hidden.has(path)) continue;
      const rect = rects.get(path), el = document.createElement(node.type === 'Button' ? 'button' : 'div');
      el.dataset.control = path; place(el, rect); win.body.appendChild(el);
      if (node.type === 'TextBox') write(el, text.get(path), node, rect.width);
      else if (node.type === 'Texture') {
        if (textures.has(path)) {
          const url = textures.get(path);
          if (url) { el.style.backgroundImage = `url("${url}")`; el.style.backgroundSize = '100% 100%'; }
        } else {
          const ref = node.textures.find(t => Skin.sprite(t));
          if (ref) Skin.apply(el, ref);
        }
      } else if (node.type === 'Button') {
        const label = text.get(path);
        Object.assign(el.style, { border: '0', padding: '0', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center' });
        el.type = 'button'; el.setAttribute('aria-label', label);
        Skin.apply(el, node.textures[0]);
        Font.set(el, label, { color: Layout.native('buttonLabel') });
        // Pressed/hover selection is intentionally not inferred from a
        // deduplicated texture list; native state binding remains work.
        el.addEventListener('click', () => node.name === 'btnLearn' ? this.state.learn() : this.state.back());
      } else if (node.type === 'TreeCtrl') this.renderList(el, rect);
    }
  }

  renderList(element, rect) {
    // Filled by the source TreeCtrl item layout, kept separate from window
    // anchors because its cursor/line-break semantics are native behavior.
    element.style.overflowY = 'auto';
    for (const skill of this.state.skills) this.renderListRow(element, skill, rect);
  }

  renderListRow(parent, skill, rect) {
    const info = skillInfo(this.skills, skill.id, skill.level), strings = this.data.strings;
    // Literal geometry and colors below are SkillTrainListWnd.uc's node
    // items, in order. Native cursor flow is independently verified by
    // mine_skilltraining.py; these are not CSS column guesses.
    const items = [
      { texture: 'l2ui_ch3.InventoryWnd.Inventory_OutLine', width: 34, height: 34, x: 0, y: 4 },
      { texture: 'l2ui_ch3.InventoryWnd.Inventory_OutLine', width: 35, height: 35, x: -33, y: 4 },
      { url: info.icon, width: 32, height: 32, x: -35, y: 5 },
      { text: info.name, oneLine: true, x: 3, y: 10 },
      { text: strings[88], oneLine: true, x: 37, y: -14, break: true, color: '#A3A3A3' },
      { text: String(skill.level), x: 2, y: -14, color: '#B09B79' },
      { text: `${strings[this.state.type === 2 ? 1437 : 365]} : `, x: 77, y: -14, break: true, color: '#A3A3A3' },
      { text: String(skill.cost), x: 0, y: -14, color: '#B09B79' },
    ];
    const flow = this.data.nativeTreeFlow;
    if (flow?.status !== 'verified-static-original' || !Number.isFinite(flow.wrapRightInset))
      throw new Error('Original trainer tree flow is unavailable');
    const layout = trainingRow(items, 7, (item, x) => {
      if (item.text == null) return { width: item.width, height: item.height };
      const width = item.oneLine ? Infinity : rect.width - x - flow.wrapRightInset;
      const lines = []; let line = '';
      for (const word of item.text.split(' ')) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && Font.measure(candidate) > width) { lines.push(line); line = word; }
        else line = candidate;
      }
      lines.push(line);
      return { width: Math.max(...lines.map(t => Font.measure(t))), height: lines.length * Font.lineHeight(), lines };
    });
    const row = document.createElement('button'); row.type = 'button';
    row.setAttribute('aria-label', `${info.name}, ${strings[88]} ${skill.level}`);
    row.style.cssText = `display:block;position:relative;width:100%;height:${Skin.px(layout.height)}px;`
      + 'padding:0;border:0;background:none;text-align:left;cursor:pointer;overflow:hidden;';
    for (const r of layout.placed) {
      const el = document.createElement('span'); place(el, r); row.appendChild(el);
      if (r.item.text != null) {
        for (const line of r.lines) {
          const block = document.createElement('div');
          block.style.height = `${Skin.px(Font.lineHeight())}px`;
          Font.set(block, line, { color: r.item.color || Layout.native('textBoxDefault') }); el.appendChild(block);
        }
      } else if (r.item.texture) Skin.apply(el, r.item.texture);
      else if (r.item.url) { el.style.backgroundImage = `url("${r.item.url}")`; el.style.backgroundSize = '100% 100%'; }
    }
    row.addEventListener('click', () => this.state.select(skill.id, skill.level));
    parent.appendChild(row);
  }
}
