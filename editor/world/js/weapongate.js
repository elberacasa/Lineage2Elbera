// Weapon-dependent skill gating (retail grays out a skill whose weapon
// condition doesn't match the equipped weapon and the click does nothing).
//
// DATA — both tier 4 (server XMLs via tools/dat/export_skillweapons.py):
//   skillweapons.json  {skillId: [weapon type names]}   aCis weaponsAllowed
//   itemtypes.json     {itemId: weapon type name} + shield flags
// skillgrp.dat itself carries NO weapon-condition field — see the export
// script header and docs/dat-format-notes.md §22 for the proof (cast_style
// 3 covers both Power Strike/sword and Mortal Blow/dagger).
//
// SEMANTICS — aCis L2Skill.getWeaponDependancy (:1048-1070): no
// weaponsAllowed -> always usable; otherwise the equipped weapon's type OR
// the left-hand shield must appear in the list (mask |= on both, then AND).

import { skillWeapons, itemTypes } from './gamedata.js';

// aCis Item.java slot bitmasks (the bridge's item `slot` IS the bodyPart)
const SLOT_R_HAND = 0x0080;
const SLOT_L_HAND = 0x0100;
const SLOT_LR_HAND = 0x4000;

export class WeaponGate {
  constructor() {
    this.weapon = null;    // equipped right-hand weapon type name, or null
    this.shield = false;   // a shield sits in the left hand
    this._weapons = {};    // skillId -> [type names]
    this._targets = {};    // skillId -> aCis target name (SELF/ONE/...)
    this._itemWeapon = {}; // itemId -> type name
    this._shields = {};    // itemId -> 1
    this.loaded = false;
  }

  async load() {
    const [sw, it] = await Promise.all([skillWeapons(), itemTypes()]);
    this._weapons = (sw && sw.weapons) || {};
    this._targets = (sw && sw.targets) || {};
    this._itemWeapon = (it && it.weapon) || {};
    this._shields = (it && it.shield) || {};
    this.loaded = true;
    return this;
  }

  /** Recompute from the inventory model (call after itemList/invUpdate). */
  update(items) {
    let weapon = null;
    let shield = false;
    for (const it of items) {
      if (!it.equipped) continue;
      if (it.slot & (SLOT_R_HAND | SLOT_LR_HAND)) {
        // unknown item ids are treated as no-weapon (server would know the
        // type and reject a restricted cast; the map covers every weapon in
        // the aCis XMLs, so this is only a degraded-data fallback)
        weapon = this._itemWeapon[String(it.itemId)] || null;
      } else if ((it.slot & SLOT_L_HAND) && this._shields[String(it.itemId)]) {
        shield = true;
      }
    }
    this.weapon = weapon;
    this.shield = shield;
  }

  /** May the skill be used with the current equipment? */
  allows(skillId) {
    const req = this._weapons[String(skillId)];
    if (!req || !req.length) return true;
    if (this.weapon && req.includes(this.weapon)) return true;
    if (this.shield && req.includes('SHIELD')) return true;
    return false;
  }

  /** aCis target routing for the skill (SELF casts need no target id). */
  targetType(skillId) {
    return this._targets[String(skillId)] || null;
  }
}
