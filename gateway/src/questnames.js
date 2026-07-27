// questId -> display name, parsed from the aCis quest Java sources
// (scripting/quest/QNNN_*.java call super(id, "Name")). The datapack loads
// the same classes, so this is authoritative. The Tutorial script is id -1
// (a "feature", not a real quest) and never appears in QuestList.
'use strict';

const fs = require('fs');
const path = require('path');

const QUEST_SRC_DIR = process.env.L2_QUEST_SRC_DIR ||
  path.resolve(__dirname, '../../server/aCis_gameserver/java/net/sf/l2j/gameserver/scripting/quest');

let table = null;

function loadQuestTable() {
  if (table) return table;
  table = new Map(); // questId -> name
  try {
    const re = /super\(\s*(\d+)\s*,\s*"([^"]+)"/;
    for (const file of fs.readdirSync(QUEST_SRC_DIR)) {
      if (!file.endsWith('.java')) continue;
      const text = fs.readFileSync(path.join(QUEST_SRC_DIR, file), 'utf8');
      const m = re.exec(text);
      if (m) table.set(Number(m[1]), m[2]);
    }
  } catch (e) {
    console.error('[questnames] failed to load from', QUEST_SRC_DIR, e.message);
  }
  return table;
}

function questName(questId) {
  return loadQuestTable().get(questId) ?? null;
}

module.exports = { loadQuestTable, questName };
