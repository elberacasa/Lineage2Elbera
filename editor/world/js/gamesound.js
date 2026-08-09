// Game events -> retail sounds.
//
// The audio engine (audio.js) knows how to play a sound at a point in the
// world. This module knows WHICH sound: it owns `assets/audio/bindings.json`,
// the compact join of npcgrp + skillsoundgrp + weapongrp produced by
// tools/audio/build_audio.py, and maps each gateway event onto the entries the
// game itself specifies. Nothing here is authored — every sound name, volume
// and radius comes out of the client's own tables.
//
// What the npcgrp fields mean, since the names mislead:
//   defense_sound  the impact — what a blow landing on this creature sounds
//                  like (its hide, armour, bone). Plays on every hit.
//   damage_sound   the creature's own voice reacting to the hit. Plays on
//                  every hit too; together they make one blow.
//   attack_sound   the swing/whoosh the creature makes when IT attacks.
// Each is a bank of alternatives (a gremlin has three of each) and the game
// picks at random, which is the only reason repeated hits don't sound like a
// loop. `sound_vol` and `sound_radius` are per-creature.
//
// Skills carry three banks: the cast (`c`, spell_sounds — plays at the caster
// as the animation starts), the shot (`s`, shot_sounds — a projectile leaving)
// and the explosion (`x`, exp_sounds — the impact on the target). Weapons
// carry four impact sounds (`h`) plus an equip (`e`) and a drop (`d`).
//
// CORRECTION (2026-08-08). The line above used to read "Nothing here is
// authored -- every sound name, volume and radius comes out of the client's
// own tables." The first half is true; the second was not:
//   * npcgrp and skillsoundgrp DO carry per-record volume and radius, and
//     assets/audio/bindings.json ships them for all 6,495 npc and 1,368
//     skill records -- 0 missing. Those paths are fully table-driven and the
//     `|| <number>` fallbacks that used to guard them were unreachable. They
//     are gone.
//   * weapongrp does NOT. bindings.json carries no `v` or `r` for any of the
//     1,311 weapon records, so the weapon hit and drop calls below were
//     playing at typed values. Marked AUTHORED at the site.
//   * weapongrp.json DOES carry a `drop_radius` per weapon (7 on the first
//     record), and tools/audio/build_audio.py never reads it -- see the drop()
//     handover below. That file has another owner; the value is on disk.

import { audio } from './audio.js';

const BINDINGS_URL = '/audio/bindings.json';

export class GameSound {
  constructor() {
    this.names = null;
    this.npc = null;
    this.skill = null;
    this.weapon = null;
    this.ready = false;
    // npcId per entity id, so a hit on entity 268435 can find its creature's
    // sound bank — the attack event only carries entity ids.
    this._npcOf = new Map();
    this._weaponId = 0;      // our own equipped weapon, for our own hit sounds
  }

  async load() {
    try {
      const res = await fetch(BINDINGS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const b = await res.json();
      this.names = b.names;
      this.npc = b.npc;
      this.skill = b.skill;
      this.weapon = b.weapon;
      this.ready = true;
    } catch (err) {
      console.warn('[gamesound] no bindings, combat will be silent:', err.message);
      this.ready = false;
    }
    return this.ready;
  }

  _refs(indices) {
    if (!indices || !indices.length) return null;
    return indices.map(i => this.names[i]);
  }

  // ---- entity bookkeeping ----------------------------------------------

  // Called on addNpc so later hits can resolve the creature's sound bank, and
  // so its sounds are already decoded before the first blow lands.
  trackNpc(entityId, npcId) {
    if (!this.ready || npcId == null) return;
    this._npcOf.set(entityId, npcId);
    const rec = this.npc[String(npcId)];
    if (!rec) return;
    const warm = [];
    for (const k of ['a', 'd', 'm']) {
      const refs = this._refs(rec[k]);
      if (refs) warm.push(...refs);
    }
    audio.prefetch(warm);
  }

  forget(entityId) { this._npcOf.delete(entityId); }
  clear() { this._npcOf.clear(); }

  setWeapon(itemId) {
    this._weaponId = itemId || 0;
    const rec = this.weapon[String(this._weaponId)];
    if (rec) audio.prefetch(this._refs(rec.h) || []);
  }

  // ---- combat -----------------------------------------------------------

  // A landed blow: the impact on the victim plus the victim's reaction. When
  // WE are the attacker the weapon's own impact sound plays too — that is the
  // sound the player is listening for, and it comes from the weapon table, not
  // the target.
  attack(msg, pos, selfId) {
    if (!this.ready || !pos) return;

    const npcId = this._npcOf.get(msg.targetId);
    const rec = npcId != null ? this.npc[String(npcId)] : null;
    if (rec) {
      const opts = { volume: rec.v, radius: rec.r };   // npcgrp's own
      audio.playOneOf(this._refs(rec.d), pos, opts);   // impact on the hide
      audio.playOneOf(this._refs(rec.m), pos, opts);   // the creature's cry
    }

    if (msg.id === selfId && this._weaponId) {
      const w = this.weapon[String(this._weaponId)];
      // AUTHORED volume and radius: weapongrp gives item_sound its four
      // impact names but no volume and no radius for them, and bindings.json
      // therefore ships none. Nothing decoded fixes these two numbers.
      if (w) audio.playOneOf(this._refs(w.h), pos, { volume: 250, radius: 40 });
    }
  }

  // A soulshot firing — now SILENT, and that is the sourced answer.
  //
  // This used to play InterfaceSound.sc_shot_01 on every hit carrying the
  // Attack packet's HITFLAG_SS. Two things are wrong with that and both were
  // checked (2026-08-08):
  //   1. WRONG SOUND. sc_shot_01 has no binding anywhere in the decoded client
  //      data (grep assets/gamedata) and it lives in interfacesound.uax next
  //      to click_01 / inventory_open_01 — it is a UI sound, picked by hand.
  //      The retail shot sounds are SkillSound.soul_shot_cast (soulshots) and
  //      SkillSound.spirits_shot_cast (spirit/blessed), which skillsoundgrp.dat
  //      binds to the shot SKILLS 2039/2047/2061 and 2150..2164.
  //   2. WRONG MOMENT. Retail's sound rides the shot's own MagicSkillUse, not
  //      the hit: aCis SoulShots.useItem charges the weapon, then broadcasts
  //      MagicSkillUse(player, player, <item_skill>, 1, 0, 0). That reaches the
  //      client as skillCast, and main.js's skillCast handler already calls
  //      cast() below, which already finds those exact sounds in
  //      assets/audio/bindings.json. The path was complete; this method was
  //      simply a second, invented sound layered on top of it.
  // Kept as a no-op so main.js's call site (js/main.js:1339, another worker's
  // file) stays valid.
  shot(_pos, _isSelf) { /* retail plays the shot sound on skillCast, see above */ }

  // The attacker's swing. Separate from attack() because a miss still swings.
  swing(entityId, pos) {
    if (!this.ready || !pos) return;
    const npcId = this._npcOf.get(entityId);
    const rec = npcId != null ? this.npc[String(npcId)] : null;
    if (rec) {
      audio.playOneOf(this._refs(rec.a), pos,
                      { volume: rec.v, radius: rec.r });   // npcgrp's own
    }
  }

  // Death reuses the creature's damage bank: Interlude gives monsters no
  // dedicated death sound, the final cry is one of the same three.
  die(entityId, pos) {
    if (!this.ready || !pos) return;
    const npcId = this._npcOf.get(entityId);
    const rec = npcId != null ? this.npc[String(npcId)] : null;
    if (rec) {
      audio.playOneOf(this._refs(rec.m), pos,
                      { volume: rec.v, radius: rec.r });   // npcgrp's own
    }
    this.forget(entityId);
  }

  // ---- skills -----------------------------------------------------------

  cast(skillId, pos) {
    if (!this.ready || !pos) return;
    const rec = this.skill[String(skillId)];
    if (!rec) return;
    const opts = { volume: rec.v, radius: rec.r };   // skillsoundgrp's own
    audio.playOneOf(this._refs(rec.c), pos, opts);
  }

  launch(skillId, pos) {
    if (!this.ready || !pos) return;
    const rec = this.skill[String(skillId)];
    if (!rec) return;
    const opts = { volume: rec.v, radius: rec.r };   // skillsoundgrp's own
    // The explosion is the impact; fall back to the shot when a skill has no
    // explosion bank (most buffs are cast-only and correctly stay quiet here).
    const impact = this._refs(rec.x) || this._refs(rec.s);
    audio.playOneOf(impact, pos, opts);
  }

  // ---- items ------------------------------------------------------------

  equip(itemId) {
    if (!this.ready) return;
    const rec = this.weapon[String(itemId)];
    if (rec && rec.e != null) audio.play2D(this.names[rec.e], { bus: 'ui' });
  }

  drop(itemId, pos) {
    if (!this.ready) return;
    const rec = this.weapon[String(itemId)];
    if (rec && rec.d != null) {
      // AUTHORED, and it should not stay that way: weapongrp.json carries a
      // `drop_radius` field per weapon (7 on the first record) that
      // tools/audio/build_audio.py does not read, so bindings.json has no
      // `r` to use here. HANDOVER to that file's owner: emit drop_radius as
      // the weapon record's `r` and this call becomes `radius: rec.r`.
      // The volume has no source in weapongrp at all.
      audio.playAt(this.names[rec.d], pos, { volume: 250, radius: 30 });
    }
  }
}

export const gameSound = new GameSound();

// Interface sounds are not table-driven — the xdat carries no sound bindings —
// so the mapping is the bank's own file names, which are explicit about the
// window each one was recorded for. The whole bank is 11 sounds; these are all
// of them, so nothing here is a guess and nothing is unused. Windows without a
// dedicated pair (skills, quest journal, shop, party...) fall back to the
// system pair, which is what the retail client does with them too.
export const UI_SOUND = {
  click:          'interfacesound.click_01',
  questAccept:    'interfacesound.quest_accept_01',
  // UNBOUND. The bank ships sc_shot_01 and nothing in the decoded client data
  // says what plays it — the old `soulshot` name was a guess and the shot path
  // no longer uses it (see GameSound.shot). Listed so the bank stays complete.
  scShot01:       'interfacesound.sc_shot_01',
  open:           'interfacesound.system_open_01',
  close:          'interfacesound.system_close_01',
};

// Window -> its [open, close] pair. Keyed by the SAME winName the geometry is
// mined under, so the key set is the xdat's, not one invented here. The bank
// ships a dedicated pair for exactly three windows plus the system pair;
// everything else falls back to system, which is what retail does with the
// windows it gave no sound of their own.
export const UI_WINDOW_SOUND = {
  _default:      ['interfacesound.system_open_01',     'interfacesound.system_close_01'],
  InventoryWnd:  ['interfacesound.inventory_open_01',  'interfacesound.inventory_close_01'],
  MinimapWnd:    ['interfacesound.map_open_01',        'interfacesound.map_close_01'],
  CharSheet:     ['interfacesound.charstat_open_01',   'interfacesound.charstat_close_01'],
};
