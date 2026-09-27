// Original RecipeBookWnd / RecipeManufactureWnd transitions. Crafting outcomes,
// learned recipes, MP and material counts come from server snapshots only.
const word = n => Number.isInteger(n) && n >= -0x80000000 && n <= 0x7fffffff;
const id = n => word(n) && n > 0;
const bookType = n => n === 0 || n === 1;

export class Recipes {
  constructor({ send = () => false, changed = () => {} } = {}) {
    this.send = send; this.changed = changed; this.reset();
  }
  reset() {
    this.bookData = null; this.makeData = null; this.capacity = null;
    this.bookOpen = false; this.makeOpen = false; this.tree = null;
    this.selected = null; this.requested = null; this.changed(this);
  }
  capacities(message) {
    if (!word(message?.recipe) || !word(message?.dwarvenRecipe)) return false;
    this.capacity = { recipe: message.recipe, dwarvenRecipe: message.dwarvenRecipe };
    this.changed(this); return true;
  }
  book(message) {
    if (!bookType(message?.bookType) || !word(message.maxMp) || !Array.isArray(message.recipes)
        || !message.recipes.every(r => id(r?.recipeId) && word(r.index))) return false;
    this.bookData = { bookType: message.bookType, maxMp: message.maxMp,
      recipes: message.recipes.map(r => ({ ...r })) };
    this.bookOpen = true; this.selected = null; this.requested = null;
    // D6 does not hide an independently open manufacture/tree window.
    this.changed(this); return true;
  }
  select(recipeId) {
    if (!this.bookOpen || !this.bookData.recipes.some(r => r.recipeId === recipeId)) return false;
    this.selected = recipeId; this.changed(this); return true;
  }
  inspect(recipeId) {
    if (!this.bookOpen || !this.bookData.recipes.some(r => r.recipeId === recipeId)) return false;
    return this.requestInfo(recipeId);
  }
  // A server-restored recipe shortcut can request AE before either book has
  // been opened. It does not learn the recipe or send the AF craft request.
  requestInfo(recipeId) {
    if (!id(recipeId)) return false;
    if (!this.send('recipeMakeInfo', { recipeId })) return false;
    this.requested = recipeId; return true;
  }
  info(message) {
    if (!id(message?.recipeId) || !bookType(message.bookType)
        || !['mp', 'maxMp', 'status'].every(k => word(message[k]))
        || (this.requested !== message.recipeId && !(this.makeOpen && this.makeData?.recipeId === message.recipeId))) return false;
    this.makeData = { recipeId: message.recipeId, bookType: message.bookType,
      mp: message.mp, maxMp: message.maxMp, status: message.status };
    // A result for the already open recipe may arrive while a shortcut asks
    // for a different recipe. It must not consume that later request.
    if (this.requested === message.recipeId) this.requested = null;
    this.bookOpen = false; this.makeOpen = true;
    this.changed(this); return true;
  }
  updateMp(message) {
    if (!this.makeOpen || !word(message?.mp)) return false;
    this.makeData = { ...this.makeData, mp: message.mp };
    this.changed(this); return true;
  }
  craft() {
    return this.makeOpen && this.send('recipeMakeSelf', { recipeId: this.makeData.recipeId });
  }
  back() {
    if (!this.makeOpen) return false;
    const result = this.send('recipeBookOpen', { bookType: this.makeData.bookType });
    this.closeMake(); return result;
  }
  deleteRecipe(recipeId, bookDataToken) {
    return this.bookOpen && this.bookData === bookDataToken
      && this.bookData.recipes.some(r => r.recipeId === recipeId)
      && this.send('recipeBookDestroy', { recipeId });
  }
  closeBook() {
    this.bookOpen = false; this.requested = null; this.changed(this);
  }
  closeMake() {
    this.makeOpen = false; this.makeData = null; this.requested = null; this.changed(this);
  }
  toggleTree(successRate) {
    if (this.tree) return this.closeTree();
    if (!this.makeOpen || !word(successRate)) return false;
    this.tree = { recipeId: this.makeData.recipeId, successRate };
    this.changed(this); return true;
  }
  closeTree() { this.tree = null; this.changed(this); return true; }
}

function inventoryCounts(items) {
  const counts = new Map();
  for (const item of items || []) {
    if (!Number.isSafeInteger(item.count) || item.count < 0) throw new Error('Recipe inventory count unavailable');
    const count = (counts.get(item.itemId) || 0) + item.count;
    if (!Number.isSafeInteger(count)) throw new Error('Recipe inventory count exceeds exact browser integer range');
    counts.set(item.itemId, count);
  }
  return counts;
}

export function recipeMaterialCounts(record, items) {
  const counts = inventoryCounts(items);
  return record.materials.map(material => ({ ...material, owned: counts.get(material.itemId) || 0,
    disabled: (counts.get(material.itemId) || 0) < material.count }));
}

// Script truncates the float product before integer division, then caps only
// the upper end. Zero maximum has no admitted replacement arithmetic.
export function recipeMpWidth(current, maximum) {
  if (!word(current) || !word(maximum) || maximum <= 0) return null;
  const product = Math.trunc(Math.fround(Math.fround(165) * Math.fround(current)));
  if (!word(product)) return null;
  return Math.min(165, Math.trunc(product / maximum));
}

export function recipeTree(data, productId, successRate, items) {
  const counts = inventoryCounts(items);
  const visible = r => JSON.stringify([r.level, r.productId, r.productCount, r.mpConsume, r.successRate, r.materials]);
  function build(product, rate, needCount, ancestors) {
    const candidates = data.records.filter(r => r.productId === product && r.successRate === rate);
    if (candidates.some(r => visible(r) !== visible(candidates[0]))) throw new Error('Ambiguous original recipe tree lookup');
    const record = candidates[0] || null, key = `${product}:${rate}`;
    if (ancestors.has(key)) throw new Error('Cyclic original recipe tree');
    const owned = counts.get(product) || 0;
    const result = { productId: product, successRate: rate, needCount, owned,
      disabled: owned < needCount, recipe: record, children: [] };
    if (record) {
      const next = new Set(ancestors).add(key);
      // Original UIDATA_RECIPE pushes literal100 for each material's rate.
      result.children = record.materials.map(m => build(m.itemId, 100, m.count, next));
    }
    return result;
  }
  return build(productId, successRate, 0, new Set());
}
