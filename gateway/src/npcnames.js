// npcId -> display name, lazily parsed from the aCis datapack XML so the
// bridge can fill addNpc.name even for NPCs without a server-side name.
'use strict';

const fs = require('fs');
const path = require('path');

const NPC_DIR = process.env.L2_NPC_XML_DIR ||
  path.resolve(__dirname, '../../server/aCis_gameserver/build/dist/gameserver/data/xml/npcs');

let table = null;

function loadNpcNames() {
  if (table) return table;
  table = new Map();
  try {
    for (const file of fs.readdirSync(NPC_DIR)) {
      if (!file.endsWith('.xml')) continue;
      const text = fs.readFileSync(path.join(NPC_DIR, file), 'utf8');
      const re = /<npc id="(\d+)" name="([^"]*)"/g;
      let m;
      while ((m = re.exec(text)) !== null) table.set(Number(m[1]), m[2]);
    }
  } catch (e) {
    console.error('[npcnames] failed to load from', NPC_DIR, e.message);
  }
  return table;
}

function npcName(npcId) {
  return loadNpcNames().get(npcId) || '';
}

module.exports = { loadNpcNames, npcName };
