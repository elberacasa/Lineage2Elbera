// Original RecipeBookWnd/RecipeManufactureWnd/RecipeTreeWnd flow. Metadata
// comes from Elbera Tools' original-client extraction, values from packets.
// Item-window insets/count badges/tints, grade emoticons, native tooltip
// drawing and exact text measurement remain explicit renderer gaps.
import { Skin } from './skin.js';
import { Font } from './font.js';
import { Layout, sourceControls } from './layout.js';
import { L2Window } from './window.js';
import { defaultWindowPosition } from './windowposition.js';
import { trainingRects } from './skilltrainwnd.js';
import { sharedDialogBox } from './dialogbox.js';
import { itemMeta, itemInfo, sysMsgMeta, renderSysMsg } from '../gamedata.js';
import { Recipes, recipeMpWidth, recipeTree, recipeMaterialCounts } from '../recipes.js';

const BOOK = 'RecipeBookWnd', MAKE = 'RecipeManufactureWnd', TREE = 'RecipeTreeWnd';
function place(el, r) {
  Object.assign(el.style, { position: 'absolute', left: `${Skin.px(r.x)}px`, top: `${Skin.px(r.y)}px`,
    width: `${Skin.px(r.width)}px`, height: `${Skin.px(r.height)}px` });
}
function paint(el, reference, sources) {
  if (reference && Skin.sprite(reference)) { Skin.apply(el, reference); return; }
  const source = sources?.[reference];
  if (!source || typeof source.file !== 'string' || !/^icons\/recipes\/[^/]+\.png$/.test(source.file)
      || ![source.width, source.height].every(n => Number.isInteger(n) && n > 0))
    throw new Error(`Original recipe artwork unavailable: ${reference}`);
  el.style.backgroundImage = `url("/gamedata/${source.file}")`;
  // Preserve decoded pixels. The source TreePlus/Minus texture is 16x16,
  // while its script rectangle is 12x12; sampler parity remains unverified.
  el.style.backgroundSize = `${Skin.px(source.width)}px ${Skin.px(source.height)}px`;
  el.style.backgroundRepeat = 'no-repeat';
  el.dataset.textureSource = source.sourceObject || reference;
}
function icon(el, url) {
  if (!url) throw new Error('Original recipe item icon unavailable');
  el.style.backgroundImage = `url("${url}")`; el.style.backgroundSize = '100% 100%';
}
function write(el, text, color, align = 'left') {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Original recipe text color unavailable');
  el.dataset.text = text; el.setAttribute('aria-label', text);
  el.style.textAlign = align; el.style.overflow = 'hidden'; Font.set(el, text, { color });
}

export class RecipeWnd {
  constructor(parent = document.body, { send, getItems = () => [], getPlayer = () => ({}), loadMetadata } = {}) {
    this.parent = parent; this.getItems = getItems; this.getPlayer = getPlayer;
    this.windows = {}; this.lastError = null; this.dialog = sharedDialogBox(parent);
    this.state = new Recipes({ send, changed: () => this.updatingMp ? this.renderMp()
      : this.selectingRecipe ? this.renderSelection() : this.render() });
    this.expanded = new Set(); this.pendingDelete = null;
    const read = loadMetadata || (async () => {
      const response = await fetch('/gamedata/recipes.json');
      if (!response.ok) throw new Error('Original recipe metadata unavailable');
      const [data, items, messages] = await Promise.all([response.json(), itemMeta(), sysMsgMeta()]);
      return { data, items, messages };
    });
    this.ready = Promise.resolve().then(read).then(({ data, items, messages }) => {
      if (data?.format !== 'l2-interlude-recipes-v1' || data.nativeLayoutProof?.status !== 'verified'
          || data.nativeTreeFlow?.status !== 'verified-static-original' || !Array.isArray(data.records)
          || !items || !messages) throw new Error('Original recipe source contract unavailable');
      this.data = data; this.items = items; this.messages = messages;
      for (const name of [BOOK, MAKE, TREE]) {
        const source = data.windows[name], p = source?.position;
        if (!p || p.target || p.selfAnchor !== p.targetAnchor) throw new Error(`Unresolved recipe anchor ${name}`);
        const origin = defaultWindowPosition({ anchor: p.selfAnchor, anchored: true,
          offsetX: p.offsetX, offsetY: p.offsetY }, { x: 0, y: 0, width: source.width, height: source.height },
        { x: 0, y: 0, width: window.innerWidth / Skin.scale, height: window.innerHeight / Skin.scale });
        if (!origin) throw new Error(`Invalid recipe window ${name}`);
        const win = new L2Window({ title: '', width: source.width, height: source.height,
          winName: name, nativeBounds: true, back: 'none' });
        win.root.id = `l2-${name}`; win.root.setAttribute('role', 'dialog');
        win.place({ left: origin.x, top: origin.y }); parent.appendChild(win.root);
        win.onClose = () => this.state[name === BOOK ? 'closeBook' : name === MAKE ? 'closeMake' : 'closeTree']();
        this.windows[name] = win;
      }
      this.render(); return this;
    }).catch(error => { this.lastError = error; console.error('RecipeWnd:', error); return this; });
  }

  book(message) { return this.state.book(message); }
  shortcutInfo(recipeId) {
    const proof = this.data?.native?.recipeShortcut;
    if (proof?.status !== 'verified-ordinary-RecipeItem-path' || proof.type !== 5
        || proof.id !== 'index' || proof.characterType !== 1 || proof.use !== 'makeInfo'
        || proof.name !== 'recipeItemId' || proof.icon !== 'productId') return null;
    try {
      const recipe = this.record(recipeId);
      return { name: this.item(recipe.recipeItemId).name, icon: this.item(recipe.productId).icon };
    } catch { return null; }
  }
  canAssignShortcut(recipeId) {
    return !!this.shortcutInfo(recipeId) && this.state.bookOpen
      && this.state.bookData.recipes.some(row => row.recipeId === recipeId);
  }
  useShortcut(recipeId) {
    return !!this.shortcutInfo(recipeId) && this.state.requestInfo(recipeId);
  }
  info(message) {
    this.pendingInfoPresentation = true;
    const accepted = this.state.info(message);
    if (!accepted) this.pendingInfoPresentation = false;
    return accepted;
  }
  capacities(message) { return this.state.capacities(message); }
  updateMp(message) {
    if (Number.isInteger(message?.id) && message.id !== this.getPlayer()?.id) return false;
    this.updatingMp = true;
    try { return this.state.updateMp(message); }
    finally { this.updatingMp = false; }
  }
  onInvUpdate() {
    if (!this.data || !this.state.makeOpen || !this.materialCells) return;
    try {
      const record = this.record(this.state.makeData.recipeId), items = this.getItems();
      const rows = recipeMaterialCounts(record, items instanceof Map ? [...items.values()] : items);
      rows.forEach((row, i) => { const cell = this.materialCells[i]; if (cell) this.updateMaterialCell(cell, row); });
    } catch (error) { this.lastError = error; }
  }
  reset() {
    this.pendingDelete = null; this.dialog.reset(this); this.expanded.clear();
    this.positionedBook = null; this.pendingInfoPresentation = false;
    this.renderedTree = null; this.treeModel = null; this.state.reset();
  }
  label(id) {
    const text = this.data.strings[id];
    if (typeof text !== 'string') throw new Error(`Original recipe label ${id} unavailable`);
    return text;
  }
  paint(el, reference) { paint(el, reference, this.data.sourceTextures); }
  record(id) {
    const row = this.data.records.find(row => row.index === id);
    if (!row) throw new Error(`Original recipe ${id} unavailable`);
    return row;
  }
  item(id) {
    if (!this.items[id]?.name || !this.items[id]?.icon) throw new Error(`Original recipe item ${id} unavailable`);
    return { ...this.items[id], ...itemInfo(this.items, id) };
  }
  fullName(id) {
    const source = this.data.itemNames?.[id];
    const sentinel = this.data.native?.fullItemName?.additionalNameSentinel;
    if (!source || typeof source.name !== 'string' || typeof source.additionalName !== 'string')
      throw new Error(`Original full item name unavailable: ${id}`);
    if (typeof sentinel !== 'string') throw new Error('Original item additional-name sentinel unavailable');
    return source.additionalName && source.additionalName !== sentinel
      ? `${source.name}-${source.additionalName}` : source.name;
  }
  count(id) {
    const items = this.getItems();
    const rows = items instanceof Map ? [...items.values()] : items;
    if (!Array.isArray(rows)) throw new Error('Recipe inventory snapshot unavailable');
    return rows.filter(row => row.itemId === id).reduce((sum, row) => {
      if (!Number.isSafeInteger(row.count) || row.count < 0) throw new Error('Invalid recipe inventory count');
      if (!Number.isSafeInteger(sum + row.count)) throw new Error('Recipe inventory count exceeds exact integer range');
      return sum + row.count;
    }, 0);
  }
  message(id, args) {
    if (!this.messages[id]?.text) throw new Error(`Original recipe system message ${id} unavailable`);
    return renderSysMsg(this.messages, id, args);
  }
  copyPosition(from, to) {
    const source = this.windows[from].root;
    // A hidden browser element reports a zero rectangle. Native GetRect
    // retains stored position; L2Window and WndMgr both store left/top.
    const left = parseFloat(source.style.left) / Skin.scale;
    const top = parseFloat(source.style.top) / Skin.scale;
    if ([left, top].every(Number.isFinite)) this.windows[to].place({ left, top });
  }
  async deleteSelected(recipeId = this.state.selected) {
    const bookData = this.state.bookData;
    if (!this.data || !this.state.bookOpen || this.pendingDelete || !bookData
        || !bookData.recipes.some(row => row.recipeId === recipeId)) return;
    const token = { bookData, recipeId }; this.pendingDelete = token;
    try {
      const source = this.record(recipeId), item = this.item(source.recipeItemId);
      const result = await this.dialog.request({ type: 'warning', owner: this, context: token,
        message: this.message(74, [item.name, '']) });
      if (result.accepted && this.pendingDelete === token)
        this.state.deleteRecipe(recipeId, bookData);
    } catch (error) { this.lastError = error; }
    finally { if (this.pendingDelete === token) this.pendingDelete = null; }
  }

  render() {
    if (!this.data || !this.windows[TREE]) return;
    if (this.positionedBook !== this.state.bookData && this.state.bookData) {
      this.copyPosition(MAKE, BOOK); this.positionedBook = this.state.bookData;
    }
    if (this.renderedTree !== this.state.tree) {
      this.expanded.clear(); this.renderedTree = this.state.tree;
      this.treeModel = null;
    }
    this.lastError = null;
    for (const [name, active] of [[BOOK, this.state.bookOpen], [MAKE, this.state.makeOpen], [TREE, !!this.state.tree]]) {
      if (!active) { this.windows[name].hide(); continue; }
      try { this.renderWindow(name); this.windows[name].show(); }
      catch (error) { this.windows[name].hide(); this.lastError = error; console.error('RecipeWnd:', error); }
    }
  }

  renderMp() {
    if (!this.state.makeOpen || !this.mpBar) return;
    const width = recipeMpWidth(this.state.makeData.mp, this.state.makeData.maxMp);
    this.mpBar.hidden = width === null || width < 0;
    if (!this.mpBar.hidden) this.mpBar.style.width = `${Skin.px(width)}px`;
  }

  renderSelection() {
    for (const cell of this.bookCells || [])
      cell.setAttribute('aria-pressed', String(Number(cell.dataset.recipeId) === this.state.selected));
  }

  renderWindow(name) {
    const win = this.windows[name], { root, entries } = sourceControls(this.data.windows[name]);
    const text = new Map(entries.map(({ node, path }) => [path,
      node.textId != null ? this.label(node.textId) : node.textLayout?.defaultText || '']));
    const set = (control, value) => {
      const found = entries.filter(e => e.node.sourceName === control);
      if (found.length !== 1) throw new Error(`Unresolved recipe control ${control}`);
      text.set(found[0].path, String(value));
    };
    let row, product;
    if (name === BOOK) {
      const packet = this.state.bookData, max = this.state.capacity?.[packet.bookType === 1 ? 'recipe' : 'dwarvenRecipe'];
      win.setTitle(this.label(packet.bookType === 1 ? 1214 : 1215));
      set('txtCount', max == null ? '' : `(${packet.recipes.length}/${max})`);
    } else {
      const packet = name === MAKE ? this.state.makeData : this.state.tree;
      row = this.record(packet.recipeId); product = this.item(row.productId);
      if (name === MAKE && this.pendingInfoPresentation) {
        this.copyPosition(BOOK, MAKE);
        this.productCountSnapshot = this.count(row.productId); this.pendingInfoPresentation = false;
        this.makeToken = {};
      }
      win.setTitle(this.label(this.data.native.windowTitles[name]));
      const fullName = this.fullName(row.productId);
      // MakeFullItemName joins the original additional name with '-'. Grade
      // backtick tokens still require the native emoticon renderer.
      set('txtName', fullName); set('txtMPConsume', row.mpConsume);
      set('txtSuccessRate', `${name === TREE ? packet.successRate : row.successRate}%`);
      if (name === MAKE) {
        set('txtResultValue', row.productCount); set('txtCountValue', this.productCountSnapshot);
        set('txtMsg', packet.status === 0 ? this.message(960, [fullName, ''])
          : packet.status === 1 ? this.message(959, [fullName, String(row.productCount)]) : '');
      } else set('txtLevel', `Lv.${row.level}`);
    }
    win.root.setAttribute('aria-label', win.title);
    const rects = trainingRects(root, text, value => Font.measure(value), Font.lineHeight());
    const oldScroll = new Map([...win.body.children || []].map(el => [el.dataset?.sourcePath, el.scrollTop]));
    win.body.replaceChildren();
    const background = document.createElement('div'); place(background, rects.get(name)); this.paint(background, root.textures[0]);
    win.body.appendChild(background);
    for (const { node, path } of entries) {
      if (node.type === 'Window') continue;
      const r = { ...rects.get(path) }, el = document.createElement(node.type === 'Button' ? 'button' : 'div');
      el.dataset.control = node.sourceName; el.dataset.sourcePath = path;
      if (node.sourceName === 'texMPBar') {
        this.mpBar = el;
        const width = recipeMpWidth(this.state.makeData.mp, this.state.makeData.maxMp);
        if (width === null || width < 0) { el.hidden = true; el.dataset.unresolved = 'native MP width domain'; }
        else r.width = width;
      }
      place(el, r); win.body.appendChild(el);
      if (node.type === 'TextBox') write(el, text.get(path), node.color || Layout.native('textBoxDefault'), node.align);
      else if (node.type === 'Texture') {
        if (node.sourceName === 'texItem') icon(el, product.icon);
        else if (node.sourceName === 'texIcon') icon(el, product.icon);
        else this.paint(el, node.textures[0]);
      } else if (node.type === 'Button') {
        el.type = 'button'; el.style.cssText += ';border:0;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center';
        this.paint(el, node.textures[0]);
        const label = text.get(path);
        if (label) write(el, label, Layout.native('buttonLabel'));
        else el.setAttribute('aria-label', node.sourceName);
        const bookData = this.state.bookData, makeToken = this.makeToken, tree = this.state.tree;
        el.addEventListener('click', () => {
          if (name === BOOK && this.state.bookData === bookData && this.state.bookOpen && node.sourceName === 'btnTrash') this.deleteSelected();
          if (name === TREE && this.state.tree === tree && node.sourceName === 'btnClose') this.state.closeTree();
          if (name !== MAKE || !this.state.makeOpen || this.makeToken !== makeToken) return;
          if (node.sourceName === 'btnManufacture') this.state.craft();
          if (node.sourceName === 'btnPrev') this.state.back();
          if (node.sourceName === 'btnClose') this.state.closeMake();
          if (node.sourceName === 'btnRecipeTree') this.state.toggleTree(row.successRate);
        });
      } else if (node.type === 'ItemWindow') this.renderGrid(el, node, r, name, row);
      else if (node.type === 'TreeCtrl') this.renderTree(el);
      if (oldScroll.has(path)) el.scrollTop = oldScroll.get(path);
    }
  }

  renderGrid(parent, node, rect, name, source) {
    const grid = node.grid;
    if (!grid || ![grid.cellX, grid.cellY, grid.gapX, grid.gapY].every(Number.isFinite))
      throw new Error(`Original recipe grid unavailable: ${node.sourceName}`);
    const pitchX = grid.cellX + grid.gapX, pitchY = grid.cellY + grid.gapY;
    const columns = Math.floor((rect.width + grid.gapX) / pitchX);
    if (columns < 1 || pitchY <= 0) throw new Error('Invalid original recipe grid');
    parent.style.overflowY = 'auto'; parent.style.overflowX = 'hidden';
    const items = this.getItems();
    const rows = name === BOOK ? this.state.bookData.recipes
      : recipeMaterialCounts(source, items instanceof Map ? [...items.values()] : items);
    if (name === MAKE) this.materialCells = [];
    else this.bookCells = [];
    const token = this.state.bookData;
    rows.forEach((row, i) => {
      const recipe = name === BOOK ? this.record(row.recipeId) : null;
      const item = this.item(recipe ? recipe.recipeItemId : row.itemId);
      const image = recipe ? this.item(recipe.productId) : item;
      const cell = document.createElement('button'); cell.type = 'button';
      cell.style.cssText = 'border:0;padding:0;background:none;cursor:pointer';
      place(cell, { x: (i % columns) * pitchX, y: Math.floor(i / columns) * pitchY,
        width: grid.cellX, height: grid.cellY }); icon(cell, image.icon);
      cell.setAttribute('aria-label', item.name); cell.title = item.name;
      if (recipe) {
        cell.dataset.recipeId = recipe.index;
        cell.draggable = !!this.shortcutInfo(recipe.index);
        cell.addEventListener('dragstart', event => {
          if (this.state.bookData !== token || !this.canAssignShortcut(recipe.index)) {
            event.preventDefault(); return;
          }
          event.dataTransfer.setData('application/x-l2vzla', JSON.stringify({ type: 'recipe', id: recipe.index }));
          event.dataTransfer.effectAllowed = 'copy';
        });
        cell.setAttribute('aria-pressed', String(this.state.selected === recipe.index));
        cell.addEventListener('click', () => {
          if (this.state.bookData !== token) return;
          // Keep the same DOM target across click/click/dblclick. Rebuilding
          // the grid after selection would swallow the browser's double click.
          this.selectingRecipe = true;
          try { this.state.select(recipe.index); } finally { this.selectingRecipe = false; }
        });
        cell.addEventListener('dblclick', () => { if (this.state.bookData === token) this.state.inspect(recipe.index); });
        this.bookCells.push(cell);
      } else {
        this.updateMaterialCell(cell, row); this.materialCells.push(cell);
      }
      parent.appendChild(cell);
    });
  }

  updateMaterialCell(cell, row) {
    cell.dataset.itemId = row.itemId; cell.dataset.owned = row.owned; cell.dataset.required = row.count;
    cell.setAttribute('aria-disabled', String(row.disabled));
    // Counts are inspectable while native badge placement and disabled tint
    // remain unproved; no invented painted counter.
    cell.setAttribute('aria-label', `${this.item(row.itemId).name} (${row.owned}/${row.count})`);
  }

  renderTree(parent) {
    // Native default expansion and nested-row origins require the source
    // evidence carried by the catalog; never silently choose an open tree.
    if (!this.treeModel) {
      const row = this.record(this.state.tree.recipeId), items = this.getItems();
      this.treeModel = recipeTree(this.data, row.productId, this.state.tree.successRate,
        items instanceof Map ? [...items.values()] : items);
    }
    this.paintTree(parent, this.treeModel);
  }

  paintTree(parent, model) {
    const proof = this.data.native?.tree;
    if (proof?.status !== 'verified-fresh-node-flow' || proof.freshRootExpanded !== true
        || proof.freshChildExpanded !== false || proof.lineBreakOrigin !== 'node-origin-before-button'
        || proof.blank !== 'flush-line-then-add-height') throw new Error('Original recipe tree expansion contract unavailable');
    parent.style.overflow = 'auto';
    const contents = document.createElement('div'); contents.style.position = 'relative'; parent.appendChild(contents);
    const treeToken = this.state.tree;
    const draw = (node, baseX, top, path, isRoot) => {
      const branching = !!node.recipe, open = branching && this.expanded.has(path);
      const x = baseX + (branching ? isRoot ? 0 : 16 : 30);
      const display = this.item(node.productId);
      const items = [
        { url: display.icon, x: branching ? 2 : 0, y: 0, width: 32, height: 32 },
        { texture: branching ? `L2UI.RecipeWnd.RecipeTreeIconBack${open ? '_click' : ''}`
          : 'L2UI.RecipeWnd.RecipeTreeIconDisableBack', x: -32, y: 0, width: 32, height: 32 },
        ...((!isRoot || !branching) && node.disabled
          ? [{ texture: 'Default.ChatBack', x: -32, y: 0, width: 32, height: 32 }] : []),
        { text: display.name, x: 5, y: branching ? 4 : 3 },
        ...(!isRoot || !branching ? [{ text: `(${node.owned}/${node.needCount})`,
          x: branching ? 51 : 37, y: -14, break: true }] : []),
      ];
      if (branching) {
        const button = document.createElement('button'); button.type = 'button';
        button.dataset.treeNode = path; button.setAttribute('aria-label', display.name);
        button.setAttribute('aria-expanded', String(open));
        button.style.cssText = 'border:0;padding:0;cursor:pointer';
        place(button, { x, y: top + 10, width: 12, height: 12 });
        this.paint(button, `L2UI.RecipeWnd.Tree${open ? 'Minus' : 'Plus'}`);
        button.addEventListener('click', () => {
          if (this.state.tree !== treeToken) return;
          if (open) this.expanded.delete(path); else this.expanded.add(path);
          this.render();
        });
        contents.appendChild(button);
      }
      // NCXMLTree keeps nodeOrigin separate from the button-reserved initial
      // cursor. A text line break uses the former, not contentX. Script Blank
      // then flushes the last line and contributes its own height (6 or 4).
      let cursor = x + (branching ? 12 : 0), y = 0, lineHeight = branching ? 22 : 0;
      for (const item of items) {
        if (item.break) { cursor = x + item.x; y += lineHeight; lineHeight = 0; }
        else cursor += item.x;
        const width = item.text == null ? item.width : Font.measure(item.text);
        const height = item.text == null ? item.height : Font.lineHeight();
        const element = document.createElement('span'); element.dataset.treePath = path;
        place(element, { x: cursor, y: top + y + item.y, width, height }); contents.appendChild(element);
        if (item.url) icon(element, item.url);
        else if (item.texture) this.paint(element, item.texture);
        else write(element, item.text, Layout.native('textBoxDefault'));
        cursor += width; lineHeight = Math.max(lineHeight, height + item.y);
      }
      let total = y + lineHeight + (branching ? 6 : 4);
      if (open) node.children.forEach((child, index) => { total += draw(child, x, top + total, `${path}/${index}`, false); });
      return total;
    };
    // The invisible root is expanded at insertion and contributes offset(1,5).
    const height = 5 + draw(model, 1, 5, 'root/0', true);
    contents.style.height = `${Skin.px(height)}px`;
  }
}
