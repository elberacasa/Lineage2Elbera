// Browser combat sound presentation. Bindings preserve original references
// and skill row/layer/gain data; native skill sound selection is verified by
// tools/ui/check_cast_sound_native.py. Event timing, spatial audio, NPC bank
// policy and weapon gain assumptions are separate parity gaps (see callsites).
// Packet-triggered skill shot/impact sounds below are still provisional.

import { audio } from './audio.js';
import { skillSoundPhase, skillSoundVoice } from './skillsound-binding.js';
// Exact authored FlyingTime is retained; its packet-relative timer below is
// provisional and does not reproduce native projectile collision timing.
import { flyingTime } from './skillvfx.js';

const BINDINGS_URL = '/audio/bindings.json';

export class GameSound {
  constructor() {
    this.names = null;
    this.npc = null;
    this.skillSoundIndex = null;
    this.weapon = null;
    this.ready = false;
    // npcId per entity id, so a hit on entity 268435 can find its creature's
    // sound bank — the attack event only carries entity ids.
    this._npcOf = new Map();
    this._weaponId = 0;      // our own equipped weapon, for our own hit sounds
    this._generation = 0;
    this._timers = new Set();
  }

  async load() {
    try {
      const res = await fetch(BINDINGS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const b = await res.json();
      this.names = b.names;
      this.npc = b.npc;
      this.skillSoundIndex = b;
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
  clear() {
    this._generation++;
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
    this._npcOf.clear();
  }

  // Retire pending positional audio decoding when the world/session changes.
  // This neither stops audio already playing nor implements per-caster
  // cancellation or native StopSpellSound.
  _sessionGuard() {
    const generation = this._generation;
    return () => generation === this._generation;
  }

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
      const opts = { volume: rec.v, radius: rec.r, isCurrent: this._sessionGuard() }; // npcgrp's own
      audio.playOneOf(this._refs(rec.d), pos, opts);   // impact on the hide
      audio.playOneOf(this._refs(rec.m), pos, opts);   // the creature's cry
    }

    if (msg.id === selfId && this._weaponId) {
      const w = this.weapon[String(this._weaponId)];
      // AUTHORED volume and radius: weapongrp gives item_sound its four
      // impact names but no volume and no radius for them, and bindings.json
      // therefore ships none. Nothing decoded fixes these two numbers.
      if (w) audio.playOneOf(this._refs(w.h), pos,
        { volume: 250, radius: 40, isCurrent: this._sessionGuard() });
    }
  }

  // No extra sound is selected from the combat soulshot hit flag. Skill
  // sound rows are handled separately by cast/launch. Their current packet
  // timing does not prove the original client's notify-driven sound timing.
  shot(_pos, _isSelf) {}

  // The attacker's swing. Separate from attack() because a miss still swings.
  swing(entityId, pos) {
    if (!this.ready || !pos) return;
    const npcId = this._npcOf.get(entityId);
    const rec = npcId != null ? this.npc[String(npcId)] : null;
    if (rec) {
      audio.playOneOf(this._refs(rec.a), pos,
                      { volume: rec.v, radius: rec.r, isCurrent: this._sessionGuard() }); // npcgrp's own
    }
  }

  // Existing death presentation reuses the creature's damage bank. Its
  // native selection policy and timing still need source call-site proof.
  die(entityId, pos) {
    if (!this.ready || !pos) return;
    const npcId = this._npcOf.get(entityId);
    const rec = npcId != null ? this.npc[String(npcId)] : null;
    if (rec) {
      audio.playOneOf(this._refs(rec.m), pos,
                      { volume: rec.v, radius: rec.r, isCurrent: this._sessionGuard() }); // npcgrp's own
    }
    this.forget(entityId);
  }

  // ---- skills -----------------------------------------------------------

  // Native PlaySkillSound visits all three source layers of the requested
  // phase, in order. The DAT loader transposes what the old parser calls
  // spell/shot/exp groups: each group is one complete three-phase layer.
  // Sound row selection has original last-exact / first-level-one precedence;
  // visual Agent lookup remains a separate exact-level rule.
  // Source selection is now native-backed; packet-driven launch placement and
  // FlyingTime scheduling below remain provisional presentation, not notify
  // or projectile parity. Ordinary voice identity must be supplied explicitly.
  _play(phase, skillId, pos, level, meshType, ownerCurrent = null) {
    if (!this.ready || !pos) return false;
    const type = { c: 1, s: 2, x: 3 }[phase];
    const sounds = skillSoundPhase(this.skillSoundIndex, skillId, level, type);
    if (sounds === null) return false;
    const sessionCurrent = this._sessionGuard();
    const isCurrent=()=>sessionCurrent() && (!ownerCurrent || ownerCurrent());
    for (const sound of sounds) audio.playAt(sound.ref, pos,
      { volume: sound.volume, radius: sound.radius, isCurrent });
    const voice = skillSoundVoice(this.skillSoundIndex, skillId, level, type, meshType);
    if (voice) audio.playAt(voice.ref, pos,
      { volume: voice.volume, radius: voice.radius, isCurrent });
    return sounds.length > 0 || voice !== null;
  }

  /** Source Agent sound tails: caller owns the native event and receiver.
   *  This deliberately creates no FlyingTime impact timer. */
  nativePhase(type,skillId,level,pos,meshType,isCurrent) {
    if (![1,2].includes(type) || typeof isCurrent!=='function' || !isCurrent()) return false;
    return this._play(type===1?'c':'s',skillId,pos,level,meshType,isCurrent);
  }

  /** Current cast presentation, using all native sound layers and lookup rules. */
  cast(skillId, pos, level, meshType) { return this._play('c', skillId, pos, level, meshType); }

  /** Current launch sound presentation. Exact Agent FlyingTime comes from
   *  the source ID/level binding; absent or unresolved Agents cannot provide
   *  a guessed explosion delay. Native legacy and notify timing remain pending. */
  launch(skillId, pos, casterPos = null, skillLevel, meshType) {
    if (!this.ready || !pos) return;
    this._play('s', skillId, casterPos || pos, skillLevel, meshType);
    const fly = flyingTime(skillId, skillLevel); // exact source value; unknown is not zero
    if (fly === null) return;
    if (fly > 0) {
      // Callers reuse scratch vectors. Capture this launch's position before
      // the timer and subsequent audio decoding, not when either completes.
      const impactPos = { x: pos.x, y: pos.y, z: pos.z };
      const isCurrent = this._sessionGuard();
      const timer = setTimeout(() => {
        if (!isCurrent()) return;
        this._timers.delete(timer);
        this._play('x', skillId, impactPos, skillLevel);
      }, fly * 1000);
      this._timers.add(timer);
    } else this._play('x', skillId, pos, skillLevel);
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
      audio.playAt(this.names[rec.d], pos,
        { volume: 250, radius: 30, isCurrent: this._sessionGuard() });
    }
  }
}

export const gameSound = new GameSound();

// Existing interface filename mappings are retained for compatibility.
// Original assets establish these names, but filenames alone do not prove
// native UI event bindings or the default-window sound policy below.
export const UI_SOUND = {
  click:          'interfacesound.click_01',
  questAccept:    'interfacesound.quest_accept_01',
  // Retained asset reference; this module has no verified event binding for it.
  scShot01:       'interfacesound.sc_shot_01',
  open:           'interfacesound.system_open_01',
  close:          'interfacesound.system_close_01',
};

// Window -> existing [open, close] pair. These filename-based assignments and
// inherited fallback require native UI call-site verification. They are not
// covered by the native skill-sound row/layer proof.
export const UI_WINDOW_SOUND = {
  _default:      ['interfacesound.system_open_01',     'interfacesound.system_close_01'],
  InventoryWnd:  ['interfacesound.inventory_open_01',  'interfacesound.inventory_close_01'],
  MinimapWnd:    ['interfacesound.map_open_01',        'interfacesound.map_close_01'],
  CharSheet:     ['interfacesound.charstat_open_01',   'interfacesound.charstat_close_01'],
};
