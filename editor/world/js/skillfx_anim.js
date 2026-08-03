// Per-skill cast ANIMATION + visual-effect presentation logic.
//
// Data (assets/gamedata/skillanim.json, tools/dat/build_skillanim.py — a
// join of skillgrp.dat + skillsoundgrp.dat, both decoded from the retail
// Interlude client):
//   anim   skillgrp.animation code: the retail cast-animation selector.
//          Single letters are native-code categories; Mix01-Mix09 / MS01
//          are literal animation names. '' = passive (no cast animation).
//   magic  is_magic (0 physical, 1 magical, 2 static, 3 dance/song)
//   range  cast_range (-1 = 0xFFFFFFFF, self/no-range)
//   style  cast_style (raw; semantics unknown, kept for reference)
//   snd    skillsoundgrp spell sounds {cast, shot, exp(losion=hit)}
//
// What the codes mean (correlation evidence, full table in the handoff):
//   S melee weapon strike (3 Power Strike, 100 Stun Attack)
//   t dagger/bow precision attack (16 Mortal Blow, 19 Double Shot)
//   V dagger critical blow (263 Deadly Blow, 344 Lethal Blow, 96 Bleed)
//   U sonic/AoE physical (9 Sonic Buster, 452 Shock Stomp)
//   Y shield attack (92 Shield Stun)      M polearm sweep (42 Sweeper)
//   Mix01-09 combo physical (1 Triple Slash, 5 Double Sonic Slash,
//     81 Punch of Doom, 7 Sonic Storm, 54 Force Blaster)
//   D beneficial magic (1216 Self Heal, 1040 Shield, 1068 Might)
//   E elemental nuke (1177 Wind Strike, 1148 Death Spike)
//   C debuff magic (1201 Dryad Root, 1069 Sleep)
//   A/G/j/K/H/f/B other magic families (War Chant, Recharge, Battle Heal,
//     Aura Burn, Inferno, Drain Health, Holy Strike)
//   X instant self-buff/stance (4 Dash, 78 War Cry, 410 Mortal Strike)
//   L self-centered taunt/aura (28 Aggression, 18 Aura of Hate)
//   i summons + raid specials (1111 Summon Kat the Cat; the Antharas-shock
//     L2FileEdit guide writes 'i')
//   N dances / W songs (is_magic 3)       MS01 Frintezza's Melody (unique)
//
// Retail target animations (Engine/Pawn.uc recovered source +
// animations/*.ukx clip names): physical skills play SpAtk01-28 / Atk01-03
// per weapon type; magic casts play CastShort/CastMid/CastLong chosen by
// cast duration (<1s / 2-5s / 5s+, per the Pawn.uc Korean comments) and
// MagicThrow/Magicshot at launch. The rebuilt character glTFs ship a
// compact retail set — castShort/castMid/castLong, magicThrow, spAtk01,
// spAtk02, die, damage — on top of the original idle/walk/run/sit/dance/
// attack (docs/character-pipeline.md §4). Clip mapping:
//   'N' dances / is_magic 3 (songs)   -> 'dance'  EXACT (Social_dance IS
//                                                   the dance-skill anim)
//   physical (is_magic 0: S/t/V/U/Y/M/Mix01-09) -> 'spAtk01'/'spAtk02',
//                                                   alternating
//   magic (is_magic 1/2)  -> 'castShort'/'castMid'/'castLong' by hitTime
// Callers fall back gracefully while pre-rebuild models are in place.

let _spAtkAlt = 0;   // alternates the two shipped physical-skill clips

// skillgrp.animation -> glTF clip for PLAYER characters. hitTime is the
// MagicSkillUse cast duration in ms (the gateway skillCast op carries it).
export function clipForSkill(entry, hitTime = null) {
  if (!entry || !entry.anim) return null;              // passive: no cast anim
  if (entry.anim === 'N' || entry.magic === 3) return 'dance';  // exact
  if (entry.magic === 0) {                             // physical SpAtk*
    _spAtkAlt = 1 - _spAtkAlt;
    return _spAtkAlt ? 'spAtk01' : 'spAtk02';
  }
  // magic cast: retail picks by cast duration (<1s / 2-5s / 5s+)
  const s = hitTime != null ? hitTime / 1000 : 2;      // unknown: mid
  if (s < 1) return 'castShort';
  if (s < 5) return 'castMid';
  return 'castLong';
}

// Beneficial ONE-target magic by anim code — main.js auto-targets self
// when such a skill is cast with no current target (retail behavior).
// Data check behind the set: every shipped ONE-target skill coded D
// (46/46 — Might, Shield, Acumen, the heals...) or A (3/3 — Greater
// Battle Heal, Master Recharge, Soul Shield) is beneficial, while every
// other code mixes in debuffs/nukes (C Sleep, E Wind Strike, j Wind
// Shackle, f Drain Health...), so those stay strict.
export function isBeneficialAnim(anim) { return anim === 'D' || anim === 'A'; }

// Effect family from the DATA (no guessing beyond the stated rules):
//   range -1/0                 -> 'aura'       (self/no-range: ring at target)
//   exp(losion) sound present, -> 'projectile' (travels caster -> target,
//   or physical with range>100                hit flash on arrival)
//   physical, range <= 100     -> 'melee'      (slash arc at the target)
//   anything else              -> 'glow'       (ranged magic without a hit
//                                               sound: colored flash)
export function classifySkill(entry) {
  if (!entry || !entry.anim) return 'none';
  if (entry.range === -1 || entry.range === 0) return 'aura';
  if ((entry.snd && entry.snd.exp) || (entry.magic === 0 && entry.range > 100)) {
    return 'projectile';
  }
  if (entry.magic === 0) return 'melee';
  return 'glow';
}

// AUTHORED color table. Neither skillgrp nor skillsoundgrp names effect
// textures or colors (verified: skillsoundgrp holds only SkillSound.* /
// chrsound.* refs), so the per-skill hue is derived from the SOUND FAMILY
// name — these colors are authored, not retail data.
const FAMILY_COLORS = [
  [/heal|cure|recovery|regen|greater_heal/i, 0x86f0b0],   // restorative green
  [/wind|twister|storm|cyclone|air/i, 0x6fd8ff],          // airy cyan
  [/fire|flame|blaz|inferno|burn|explotion|explosion/i, 0xff9040], // fire
  [/ice|frost|aqua|blizzard|freeze|water/i, 0x9fd0ff],    // ice blue
  [/holy|divine|sacred|light|bless/i, 0xfff2c0],          // holy warm white
  [/dark|death|curse|vampir|poison|bleed|decey|decay|fear/i, 0xb070ff], // violet
  [/lightning|shock|thunder/i, 0xd0e8ff],                 // electric
];

export function effectColor(entry) {
  const names = entry && entry.snd
    ? [entry.snd.cast, entry.snd.shot, entry.snd.exp].filter(Boolean)
    : [];
  for (const [re, color] of FAMILY_COLORS) {
    if (names.some(n => re.test(n))) return color;
  }
  // defaults: arcane blue for magic (the pre-existing flash hue), amber for
  // physical strikes — AUTHORED, same caveat as the family table
  return entry && entry.magic ? 0x80c0ff : 0xffc060;
}

// Tail-scan the net message ring for the skill op currently being handled.
// NetClient logs 'in' messages BEFORE emitting (net.js), so during a
// skillCast/skillLaunch handler the message is already the log tail.
// Pure function: pass window.__world.net.log. opts: {op, casterId}.
export function lastSkillMsg(log, { op = null, casterId = null, scan = 12 } = {}) {
  if (!log || !log.length) return null;
  for (let i = log.length - 1; i >= 0 && i >= log.length - scan; i--) {
    const m = log[i];
    if (m.dir !== 'in') continue;
    if (m.op !== 'skillCast' && m.op !== 'skillLaunch') continue;
    if (op && m.op !== op) return null;         // newest skill op is another kind
    if (casterId != null && m.casterId !== casterId) return null;
    return m;
  }
  return null;
}
