import test from 'node:test';
import assert from 'node:assert/strict';
import { Recipes, recipeMaterialCounts, recipeMpWidth, recipeTree } from '../js/recipes.js';

// Portable protocol/edge cases only. These synthetic numbers are not game data.
const book = { bookType: 1, maxMp: 200, recipes: [{ recipeId: 7, index: 0 }] };
const info = { recipeId: 7, bookType: 1, mp: 100, maxMp: 200, status: -1 };
function fixture() {
  const sent = [];
  const state = new Recipes({ send: (op, data) => { sent.push({ op, ...data }); return true; } });
  return { state, sent };
}
function open(state) { state.book(book); state.inspect(7); state.info(info); }

test('book ordinal never substitutes for recipe identity; only a server reply opens manufacture', () => {
  const { state, sent } = fixture(); state.book(book);
  assert.equal(state.select(0), false); assert.equal(state.inspect(0), false);
  assert.equal(state.select(7), true); assert.equal(state.inspect(7), true);
  assert.equal(state.bookOpen, true); assert.equal(state.makeOpen, false);
  assert.equal(state.info({ ...info, recipeId: 8 }), false);
  assert.equal(state.info(info), true);
  assert.equal(state.bookOpen, false); assert.equal(state.makeOpen, true);
  const before = state.makeData;
  assert.equal(state.craft(), true);
  assert.equal(state.makeData, before); assert.equal(state.makeData.status, -1);
  assert.deepEqual(sent, [{ op: 'recipeMakeInfo', recipeId: 7 }, { op: 'recipeMakeSelf', recipeId: 7 }]);
  assert.equal(state.info({ ...info, mp: 80, status: 0 }), true);
  assert.equal(state.makeData.status, 0);
  assert.equal(state.info({ ...info, mp: 60, status: 1 }), true);
  assert.equal(state.makeData.status, 1);
});
test('restored shortcuts request details without a book and never craft or learn locally', () => {
  const { state, sent } = fixture();
  assert.equal(state.inspect(7), false);
  for (const invalid of [0, -1, '7', 1.5, 0x80000000]) assert.equal(state.requestInfo(invalid), false);
  assert.equal(state.requestInfo(7), true); assert.equal(state.makeOpen, false);
  assert.equal(state.info({ ...info, recipeId: 8 }), false);
  assert.equal(state.info(info), true); assert.equal(state.bookData, null);
  assert.deepEqual(sent, [{ op: 'recipeMakeInfo', recipeId: 7 }]);
  state.closeMake(); state.requestInfo(7); state.reset(); assert.equal(state.info(info), false);
  state.send = () => false; assert.equal(state.requestInfo(7), false); assert.equal(state.requested, null);
});
test('an in-flight result for the current recipe cannot consume a different shortcut detail request', () => {
  const { state } = fixture(); open(state); state.requestInfo(8);
  assert.equal(state.info({ ...info, status: 1 }), true); assert.equal(state.requested, 8);
  assert.equal(state.info({ ...info, recipeId: 8 }), true); assert.equal(state.makeData.recipeId, 8);
  assert.equal(state.requested, null);
  assert.equal(state.info({ ...info, status: 1 }), false, 'old recipe cannot replace the newly opened one');
});
test('independent original windows keep tree and manufacture when a book is received', () => {
  const { state, sent } = fixture(); open(state); state.toggleTree(73);
  const tree = state.tree, make = state.makeData;
  state.book({ ...book, bookType: 0 });
  assert.equal(state.makeData, make); assert.equal(state.tree, tree);
  assert.equal(state.makeOpen, true); assert.equal(state.bookOpen, true);
  state.back();
  assert.deepEqual(sent.at(-1), { op: 'recipeBookOpen', bookType: 1 });
  assert.equal(state.makeOpen, false); assert.equal(state.tree, tree);
  state.closeBook(); assert.equal(state.tree, tree);
  state.closeTree(); assert.equal(state.tree, null);
});
test('warning confirmation uses captured book and selected recipe, never later selection', () => {
  const { state, sent } = fixture(); state.book({ ...book, recipes: [...book.recipes, { recipeId: 8, index: 1 }] });
  const token = state.bookData;
  state.select(7); state.select(8); assert.equal(state.deleteRecipe(7, token), true);
  assert.deepEqual(sent.at(-1), { op: 'recipeBookDestroy', recipeId: 7 });
  assert.equal(state.bookData.recipes.length, 2);
  state.book(book); assert.equal(state.deleteRecipe(7, token), false);
  assert.equal(state.deleteRecipe(8, state.bookData), false);
  const next = state.bookData; state.closeBook(); assert.equal(state.deleteRecipe(7, next), false);
});
test('close, book replacement and disconnect retire delayed manufacture replies', () => {
  for (const retire of [s => s.closeBook(), s => s.book(book), s => s.reset()]) {
    const { state } = fixture(); state.book(book); state.inspect(7); retire(state);
    assert.equal(state.info(info), false);
  }
  const { state } = fixture(); open(state); state.closeMake();
  assert.equal(state.info({ ...info, status: 1 }), false);
  state.capacities({ recipe: 90, dwarvenRecipe: 91 }); open(state); state.toggleTree(73);
  state.reset();
  for (const key of ['capacity', 'makeData', 'bookData', 'tree']) assert.equal(state[key], null);
});
test('malformed replies preserve state and copied snapshots cannot mutate their input', () => {
  const { state } = fixture(); state.book(book); const prior = state.bookData;
  for (const bad of [{ ...book, bookType: 2 }, { ...book, recipes: [{ recipeId: 0, index: 0 }] }, { ...book, maxMp: NaN }])
    assert.equal(state.book(bad), false);
  assert.equal(state.bookData, prior); assert.notEqual(prior.recipes[0], book.recipes[0]);
  state.inspect(7); assert.equal(state.info({ ...info, status: 1.5 }), false);
  state.info(info); assert.equal(state.updateMp({ mp: 75 }), true); assert.equal(state.makeData.maxMp, 200);
  assert.equal(state.updateMp({ mp: undefined }), false);
  assert.equal(state.capacities({ recipe: 90 }), false); assert.equal(state.capacity, null);
});
test('float multiply truncates before integer divide and only original upper cap applies', () => {
  assert.equal(recipeMpWidth(100, 200), 82); assert.equal(recipeMpWidth(201, 200), 165);
  assert.equal(recipeMpWidth(-10, 200), -8); assert.equal(recipeMpWidth(0, 200), 0);
  for (const args of [[1, 0], [1.5, 10], [Infinity, 10], [0x7fffffff, 10]])
    assert.equal(recipeMpWidth(...args), null);
});
test('materials use exact live inventory totals in source order without product-count multiplication', () => {
  const materials = [{ itemId: 20, count: 3 }, { itemId: 10, count: 1 }];
  assert.deepEqual(recipeMaterialCounts({ materials }, [{ itemId: 20, count: 1 }, { itemId: 20, count: 2 }]),
    [{ itemId: 20, count: 3, owned: 3, disabled: false }, { itemId: 10, count: 1, owned: 0, disabled: true }]);
  assert.throws(() => recipeMaterialCounts({ materials }, [{ itemId: 20, count: Number.MAX_SAFE_INTEGER }, { itemId: 20, count: 1 }]), /exact/);
});
test('tree uses product plus exact rate; child rate is native literal 100', () => {
  const row = { index: 7, recipeItemId: 8, productId: 10, successRate: 73, productCount: 5,
    level: 2, mpConsume: 6, materials: [{ itemId: 20, count: 3 }] };
  const child = { ...row, index: 9, productId: 20, successRate: 100, materials: [{ itemId: 30, count: 2 }] };
  const data = { records: [row, child, { ...child, index: 11, successRate: 73, materials: [] }] };
  const result = recipeTree(data, 10, 73, [{ itemId: 20, count: 2 }]);
  assert.equal(result.recipe, row); assert.equal(result.needCount, 0);
  assert.equal(result.children[0].recipe, child); assert.equal(result.children[0].disabled, true);
  assert.equal(result.children[0].children[0].needCount, 2);
  assert.equal(recipeTree(data, 10, 100, []).recipe, null);
  assert.equal(recipeTree(data, 8, 73, []).recipe, null);
  assert.doesNotThrow(() => recipeTree({ records: [...data.records, { ...row, index: 12, recipeItemId: 99 }] }, 10, 73, []));
  assert.throws(() => recipeTree({ records: [...data.records, { ...row, mpConsume: 99 }] }, 10, 73, []), /Ambiguous/);
  assert.throws(() => recipeTree({ records: [{ ...child, materials: [{ itemId: 20, count: 1 }] }] }, 20, 100, []), /Cyclic/);
});
