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
      const opts = { volume: rec.v || 250, radius: rec.r || 250 };
      audio.playOneOf(this._refs(rec.d), pos, opts);   // impact on the hide
      audio.playOneOf(this._refs(rec.m), pos, opts);   // the creature's cry
    }

    if (msg.id === selfId && this._weaponId) {
      const w = this.weapon[String(this._weaponId)];
      if (w) audio.playOneOf(this._refs(w.h), pos, { volume: 250, radius: 40 });
    }
  }

  // The attacker's swing. Separate from attack() because a miss still swings.
  swing(entityId, pos) {
    if (!this.ready || !pos) return;
    const npcId = this._npcOf.get(entityId);
    const rec = npcId != null ? this.npc[String(npcId)] : null;
    if (rec) {
      audio.playOneOf(this._refs(rec.a), pos,
                      { volume: rec.v || 250, radius: rec.r || 250 });
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
                      { volume: rec.v || 250, radius: rec.r || 250 });
    }
    this.forget(entityId);
  }

  // ---- skills -----------------------------------------------------------

  cast(skillId, pos) {
    if (!this.ready || !pos) return;
    const rec = this.skill[String(skillId)];
    if (!rec) return;
    const opts = { volume: rec.v || 250, radius: rec.r || 50 };
    audio.playOneOf(this._refs(rec.c), pos, opts);
  }

  launch(skillId, pos) {
    if (!this.ready || !pos) return;
    const rec = this.skill[String(skillId)];
    if (!rec) return;
    const opts = { volume: rec.v || 250, radius: rec.r || 50 };
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
  soulshot:       'interfacesound.sc_shot_01',
  open:           'interfacesound.system_open_01',
  close:          'interfacesound.system_close_01',
};

// Window title -> its own open/close pair where the bank provides one.
export const UI_WINDOW_SOUND = {
  CharSheet:     ['interfacesound.charstat_open_01',   'interfacesound.charstat_close_01'],
  InventoryWnd:  ['interfacesound.inventory_open_01',  'interfacesound.inventory_close_01'],
  MinimapWnd:    ['interfacesound.map_open_01',        'interfacesound.map_close_01'],
  SystemMenuWnd: ['interfacesound.system_open_01',     'interfacesound.system_close_01'],
};
