// Skill metadata helpers. Player animation selection lives in castanim.js:
// skillgrp.animation -> original APawn::SetSkillAnim slots -> pawn stance table.
// See native-skillanim.js and docs/native-skill-animation-evidence.md.
// The old clipForSkill fallback guessed physical slots and magic duration
// thresholds. It was removed after the original selector disproved those rules.

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

// The AUTHORED per-skill colour table that used to live here is GONE.
// It derived a hue from the skill's SOUND-family name (heal -> green, wind ->
// cyan, ...) with an arcane-blue/amber default — plausible, but invented, and
// the same class of placeholder as main.js's `hue = skillId * 47 % 360`.
//
// Skill colour now comes from the retail effect tables: LineageEffect.u's
// per-emitter ColorScale ramps and ColorMultiplierRange, gated on UseColorScale,
// modulating the actual retail particle textures. See js/skillvfx.js and
// tools/dat/build_skillvfx.py. Skills the retail data does not bind get NO
// colour and NO effect, by design.
//
// classifySkill() below is retained: it is used for nothing visual any more,
// but the range/sound-derived family is still a useful data-only classifier.

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
