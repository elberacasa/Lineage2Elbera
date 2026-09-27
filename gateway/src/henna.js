'use strict';

// Elbera Tools: installed aCis Henna*.java wire compatibility. These names
// describe those writers, not a claim about the original client callbacks.
// Raw C values and unknown DWORDs remain uninterpreted. In particular,
// HennaInfo statBytes may encode negative deltas; do not treat them as totals.
const STATS = ['INT', 'STR', 'CON', 'MEN', 'DEX', 'WIT'];

function rowCount(reader, width, kind) {
  const count = reader.readD();
  if (count < 0 || count * width !== reader.remaining())
    throw new RangeError(`invalid ${kind} row count or packet length`);
  return count;
}

function readHennaInfo(reader) {
  const statBytes = Object.fromEntries(STATS.map(name => [name, reader.readC()]));
  const maxSlots = reader.readD(), count = rowCount(reader, 8, 'HennaInfo');
  const symbols = [];
  for (let i = 0; i < count; i++) symbols.push({
    symbolId: reader.readD(), usableSymbolId: reader.readD(),
  });
  return { statBytes, maxSlots, symbols };
}

function readItem(reader) {
  return { symbolId: reader.readD(), dyeId: reader.readD(), amount: reader.readD(),
    price: reader.readD(), unknown: reader.readD() };
}

function readHennaList(reader, removing) {
  const adena = reader.readD(), slots = reader.readD();
  const count = rowCount(reader, 20, removing ? 'HennaUnequipList' : 'HennaEquipList');
  const items = [];
  for (let i = 0; i < count; i++) items.push(readItem(reader));
  // The installed writers use DIFFERENT meanings for this header DWORD.
  return { adena, [removing ? 'emptySlots' : 'maxSlots']: slots, items };
}

function readHennaItemInfo(reader) {
  // Six header DWORDs, then six (current D, after C) stat pairs.
  if (reader.remaining() !== 54) throw new RangeError('invalid Henna item info packet length');
  const item = readItem(reader), adena = reader.readD();
  const stats = Object.fromEntries(STATS.map(name => [name, {
    current: reader.readD(), after: reader.readC(),
  }]));
  return { ...item, adena, stats };
}

const validHennaWord = value => Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
const validHennaSymbolId = value => validHennaWord(value) && value > 0;

module.exports = { readHennaInfo, readHennaList, readHennaItemInfo,
  validHennaWord, validHennaSymbolId };
