import test from 'node:test';
import assert from 'node:assert/strict';
import { Henna, HENNA_STATS, inventoryHenna } from '../js/henna.js';

// Portable synthetic protocol cases; no original character, price or tattoo data.
const item = { symbolId: 7, dyeId: 9, amount: 10, price: 123, unknown: 1 };
const details = { ...item, adena: 500, stats: Object.fromEntries(HENNA_STATS.map(k => [k, {current:30,after:31}])) };
const snapshot = { maxSlots: 3, statBytes: Object.fromEntries(HENNA_STATS.map(k => [k,255])),
  symbols: [{symbolId:7,usableSymbolId:7}] };
function fixture() {
  const sent = [];
  const state = new Henna({ send: (op, data) => { sent.push({op,...data}); return true; } });
  return {state,sent};
}
test('list/detail/apply uses received identity and leaves money, symbols and stats authoritative', () => {
  const {state,sent}=fixture(); state.update(snapshot);
  state.list('equip',{adena:500,maxSlots:3,items:[item]});
  assert.equal(state.select(99),false); assert.equal(state.select(7),true);
  assert.equal(state.view,'list');
  assert.equal(state.details('unequip',details),false);
  assert.equal(state.details('equip',details),true);
  assert.equal(state.view,'info'); assert.equal(state.confirm(),true);
  assert.equal(state.view,null); assert.equal(state.adena,500);
  assert.deepEqual(state.snapshot,snapshot);
  assert.deepEqual(sent,[{op:'hennaItemInfo',symbolId:7},{op:'hennaEquip',symbolId:7}]);
});
test('remove and back use distinct requests; unknown list DWORD is never invented', () => {
  const {state,sent}=fixture();
  state.list('unequip',{adena:500,emptySlots:2,items:[item]}); state.select(7); state.details('unequip',details);
  assert.equal(state.back(),false); assert.equal(state.view,null);
  assert.deepEqual(sent,[{op:'hennaUnequipInfo',symbolId:7}]);
  state.listArgument=()=>1234; // explicit synthetic caller argument
  state.list('unequip',{adena:500,emptySlots:2,items:[item]}); state.select(7); state.details('unequip',details);
  assert.equal(state.back(),true); assert.deepEqual(sent.at(-1),{op:'hennaUnequipList',unknown:1234});
  state.list('unequip',{adena:500,emptySlots:2,items:[item]}); state.select(7); state.details('unequip',details);
  state.confirm(); assert.deepEqual(sent.at(-1),{op:'hennaUnequip',symbolId:7});
});
test('closing, replacing a list and resetting retire delayed details without inventing request IDs', () => {
  const {state}=fixture(); assert.equal(state.details(undefined,undefined),false);
  for(const retire of [()=>state.close(),()=>state.reset(),()=>state.list('equip',{adena:500,items:[]})]) {
    state.list('equip',{adena:500,items:[item]}); state.select(7); retire();
    assert.equal(state.details('equip',details),false);
  }
  state.update(snapshot); state.reset(); assert.equal(state.snapshot,null);
});
test('malformed snapshots/details leave previous state intact and copied rows cannot be mutated externally', () => {
  const {state}=fixture(); state.update(snapshot); const retained=state.snapshot;
  assert.equal(state.update({...snapshot,symbols:[{symbolId:7}]}),false); assert.equal(state.snapshot,retained);
  state.list('equip',{adena:500,items:[item]}); state.select(7);
  assert.equal(state.details('equip',{...details,stats:{}}),false);
  assert.equal(state.details('equip',{...details,stats:{...details.stats,STR:{current:30,after:-1}}}),false);
  state.details('equip',details); state.info.stats.STR.after=40;
  assert.equal(details.stats.STR.after,31); assert.notEqual(state.snapshot.symbols,snapshot.symbols);
});
test('inventory rows follow supplied native class step, original order, inactive flag and missing-record break', () => {
  const data={native:{classSteps:{9000:2}},records:[{symbolId:7,name:'Synthetic',text1:'description',icon:'synthetic'}]};
  assert.deepEqual(inventoryHenna(snapshot,9001,data),{rows:0,items:[]});
  const result=inventoryHenna({...snapshot,symbols:[{symbolId:7,usableSymbolId:0},{symbolId:99,usableSymbolId:99},snapshot.symbols[0]]},9000,data);
  assert.equal(result.rows,2); assert.equal(result.items.length,1); assert.equal(result.items[0].disabled,true);
});
