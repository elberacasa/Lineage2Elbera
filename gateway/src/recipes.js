'use strict';

// Elbera Tools: configured aCis RecipeBookItemList, RecipeItemMakeInfo and
// ExStorageMaxCount wire contracts. Raw values are server state; this module
// neither calculates craft results nor interprets the original client UI.
function readRecipeBook(reader) {
  // Installed aCis sends getMaxMp here. Original event 820 instead labels
  // this same wire field CurrentMP; the original book script does not use it.
  const bookType = reader.readD(), maxMp = reader.readD(), count = reader.readD();
  if (count < 0 || count * 8 !== reader.remaining())
    throw new RangeError('invalid RecipeBookItemList row count or packet length');
  const recipes = [];
  for (let i = 0; i < count; i++) recipes.push({ recipeId: reader.readD(), index: reader.readD() });
  // The second row DWORD is the installed writer's ordinal, not the ID
  // accepted by RequestRecipeBookDestroy/ItemMakeInfo/ItemMakeSelf.
  return { bookType, maxMp, recipes };
}

function readRecipeMakeInfo(reader) {
  if (reader.remaining() !== 20) throw new RangeError('invalid RecipeItemMakeInfo packet length');
  return { recipeId: reader.readD(), bookType: reader.readD(), mp: reader.readD(),
    maxMp: reader.readD(), status: reader.readD() };
}

function readStorageMaxCount(reader) {
  if (reader.remaining() !== 28) throw new RangeError('invalid ExStorageMaxCount packet length');
  return Object.fromEntries(['inventory', 'warehouse', 'freight', 'privateSell', 'privateBuy',
    'dwarvenRecipe', 'recipe'].map(key => [key, reader.readD()]));
}

const validRecipeId = value => Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
const validRecipeBookType = value => value === 0 || value === 1;

module.exports = { readRecipeBook, readRecipeMakeInfo, readStorageMaxCount,
  validRecipeId, validRecipeBookType };
