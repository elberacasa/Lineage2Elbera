// itemId -> aCis WeaponType name, lazily parsed from the aCis datapack item
// XML (the same files ItemData loads server-side, so this is authoritative —
// exactly what Creature.getAttackType() returns for a wielded weapon).
//
// Why the bridge needs it: CreatureAttack.doAttack switches on the attack type
// to decide WHEN inside a swing each hit of the broadcast Attack packet is
// actually applied. Without the type there is no way to place the hit in time,
// and the client ends up drawing the damage at the start of the swing.
'use strict';

const fs = require('fs');
const path = require('path');

const ITEM_DIR = process.env.L2_ITEM_XML_DIR ||
  path.resolve(__dirname, '../../server/aCis_gameserver/build/dist/gameserver/data/xml/items');
const ITEM_DIR_FALLBACK =
  path.resolve(__dirname, '../../server/aCis_datapack/data/xml/items');

let table = null;

function loadTable() {
  if (table) return table;
  table = new Map(); // itemId -> WeaponType name
  const dir = fs.existsSync(ITEM_DIR) ? ITEM_DIR : ITEM_DIR_FALLBACK;
  try {
    // one <item ...> block at a time; only Weapon items carry weapon_type
    const re = /<item id="(\d+)" type="Weapon"[\s\S]*?<\/item>/g;
    const typeRe = /<set name="weapon_type" val="([A-Z]+)"/;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.xml')) continue;
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      let m;
      while ((m = re.exec(text)) !== null) {
        const t = typeRe.exec(m[0]);
        if (t) table.set(Number(m[1]), t[1]);
      }
    }
  } catch (err) {
    // The gateway must still serve without the datapack checked out; hit
    // timing then falls back to the default (non-bow, non-dual) branch.
    console.error('[weapontypes] item XML unavailable:', err.message);
  }
  return table;
}

/** aCis WeaponType name for an equipped right-hand item id, or 'NONE'. */
function weaponType(itemId) {
  if (!itemId) return 'NONE';
  return loadTable().get(Number(itemId)) || 'NONE';
}

function size() { return loadTable().size; }

module.exports = { weaponType, size };
