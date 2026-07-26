// npcId -> display name + template level, lazily parsed from the aCis
// datapack XML (the same files NpcData loads server-side, so this is
// authoritative). aCis 409's NpcInfo packet carries NO level field — the
// bridge fills addNpc.level from this table (or the "Lv N" title prefix
// when Config.ShowNpcLevel is on).
'use strict';

const fs = require('fs');
const path = require('path');

const NPC_DIR = process.env.L2_NPC_XML_DIR ||
  path.resolve(__dirname, '../../server/aCis_gameserver/build/dist/gameserver/data/xml/npcs');

let table = null;

function loadNpcTable() {
  if (table) return table;
  table = new Map(); // npcId -> {name, level}
  try {
    const re = /<npc id="(\d+)" name="([^"]*)"[^>]*>([\s\S]*?)<\/npc>/g;
    const lvlRe = /<set name="level" val="(\d+)"/;
    for (const file of fs.readdirSync(NPC_DIR)) {
      if (!file.endsWith('.xml')) continue;
      const text = fs.readFileSync(path.join(NPC_DIR, file), 'utf8');
      let m;
      while ((m = re.exec(text)) !== null) {
        const lvl = lvlRe.exec(m[3]);
        table.set(Number(m[1]), { name: m[2], level: lvl ? Number(lvl[1]) : null });
      }
    }
  } catch (e) {
    console.error('[npcnames] failed to load from', NPC_DIR, e.message);
  }
  return table;
}

function npcName(npcId) {
  const t = loadNpcTable().get(npcId);
  return t ? t.name : '';
}

function npcLevel(npcId) {
  const t = loadNpcTable().get(npcId);
  return t ? t.level : null;
}

// Backwards-compatible alias used by server.js for the startup log.
function loadNpcNames() {
  const m = new Map();
  for (const [id, t] of loadNpcTable()) m.set(id, t.name);
  return m;
}

module.exports = { loadNpcNames, loadNpcTable, npcName, npcLevel };
