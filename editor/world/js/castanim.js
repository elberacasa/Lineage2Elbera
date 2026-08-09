// castanim.js — the client's OWN pawn animation table at runtime.
//
// DATA: /characters/pawnanim.json, written by tools/anim/build_pawnanim.py out
// of assets/interlude/system/lineagewarrior.int (Engine.Pawn's localized
// `<Slot>AnimName[stance]` arrays, 14 race/sex sections) joined to the
// AnimNotify keyframes inside animations/<Pkg>.ukx. Nothing here derives a
// clip name from a string rule; every answer is a lookup in retail's table.
//
// WHY THIS FILE EXISTS
// --------------------
// The runtime used to build a stanced clip name by concatenation —
// `spAtk01` + '_' + stance — and fall back to the unstanced clip when the
// model did not ship the result. Measured against the client's own table
// that is wrong for 10 of the 84 (pawn, stance) pairs, and every one of the
// ten is a case where retail plays a plain attack clip and the port plays a
// one-handed-sword special instead:
//
//   orc_fighter_m  + bow   client atk01_bow  (atk01_Bow_Morc)     concat spAtk01
//   orc_fighter_f  + bow   client atk01_bow  (atk01_Bow_Forc)     concat spAtk01
//   orc_mystic_m   + bow   client atk01_bow  (atk01_Bow_MShaman)  concat spAtk01
//   orc_mystic_f   + bow   client atk01_bow  (atk01_Bow_FShaman)  concat spAtk01
//   dwarf_m        + bow   client atk01_bow  (atk01_Bow_MDwarf)   concat spAtk01
//   dwarf_f        + bow   client atk01_bow  (atk01_Bow_FDwarf)   concat spAtk01
//   human_mystic_m + bow   client atk01_bow  (atk01_Bow_MMagic)   concat spAtk01
//   human_mystic_f + bow   client atk01_bow  (atk01_Bow_FMagic)   concat spAtk01
//   human_mystic_m + 1hs   client atk01_1hs  (Atk01_1HS_MMagic)   concat spAtk01
//   human_mystic_f + 1hs   client atk01_1hs  (Atk01_1HS_FMagic)   concat spAtk01
//
// `spAtk01` is the ANIM_CANDIDATES alias for SpAtk01_1HS (build_characters.py),
// so in all ten the character swings a one-handed-sword special — while
// holding a bow in eight of them.
//
// (verify_castanim.js gate A re-measures the ten; tools/anim/audit_castanim.py
// counts them from the data side.)
//
// WHAT THE TABLE SETTLES, AND WHAT IT DOES NOT
// --------------------------------------------
// SETTLED — the weapon-stance question:
//   * the seven magic slots (castShort/castMid/castLong/castEnd/magicShot/
//     magicThrow/magicNoTarget) carry the SAME clip at all six stances, on
//     all 14 pawns: 98/98. A magic cast does NOT vary with the weapon.
//   * the physical spAtkNN slots DO vary by stance, and the slot number is
//     not the clip number (MFighter spAtk25 at Dual is SpAtk03_1HS;
//     spAtk15 at Dual is the shield bash; spAtk05 is the dance at every
//     stance; spAtk28 is social_atk).
//
// NOT SETTLED — which spAtk SLOT a given skill uses. skillgrp.dat's
// `animation` code ('S', 't', 'V', 'Mix01' …) is the per-skill selector and
// nothing in the shipped client maps it to a slot number: engine.dll is
// Themida-packed (its exports prove GetSpAtk01..28AnimName exist, no data
// string survives), no .u name table holds a SpAtk name, and
// MobSkillAnimgrp.dat's 5463 rows are authored per NPC and correlate with
// the letter not at all. So PHYS_SLOT below stays at ONE slot for every
// physical skill and says so out loud. Spreading a guess over ~500 skills
// would look like progress and be unfalsifiable.

const PAWNANIM_URL = '/characters/pawnanim.json';

let _table = null;
let _pending = null;

/** Load (and cache) the pawn animation table. Resolves to null if absent —
 *  every caller degrades to its previous behaviour rather than throwing. */
export function pawnAnim() {
  if (_table) return Promise.resolve(_table);
  if (!_pending) {
    _pending = fetch(PAWNANIM_URL)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { _table = j; return j; })
      .catch(() => null);
  }
  return _pending;
}

/** Test seam: inject the table without a fetch. */
export function setPawnAnim(table) { _table = table; _pending = null; return table; }

/**
 * The glTF clip retail plays for one animation SLOT of one pawn at one
 * stance, or null when the client's table has no entry there.
 *
 * null is a real answer and is returned rather than substituted: retail
 * genuinely leaves combinations empty (MFighter has no spAtk01 at Hand,
 * MOrc none at Dual). Inventing a substitute is exactly the bug this file
 * replaces.
 */
export function slotClip(table, modelId, slot, stance) {
  const m = table && table.models && table.models[modelId];
  if (!m || !m.slots) return null;
  const row = m.slots[slot];
  if (!row) return null;
  const hit = row[stance] || null;
  return hit ? hit.clip : null;
}

/** The keyframe record for a shipped clip: {seq, frames, rate, dur, notifies}. */
export function clipInfo(table, modelId, clip) {
  const c = table && table.clips && table.clips[modelId];
  return (c && c[clip]) || null;
}

/**
 * Retail's own keyframe times for one notify kind inside a clip, as a
 * FRACTION OF THE SHIPPED glTF CLIP (`u`, not `t` — see build_pawnanim.py:
 * the exporter's clip is one frame shorter than retail's sequence).
 *
 * 'AttackShot' is the hit/launch instant, 'AttackPreShot' the committed
 * wind-up, 'Channeling' the channel loop point.
 */
export function notifyTimes(table, modelId, clip, kind) {
  const info = clipInfo(table, modelId, clip);
  if (!info || !info.notifies) return [];
  return info.notifies.filter(n => n.kind === kind).map(n => n.u);
}

// The one physical slot the runtime uses, and the reason it is one.
// slot 1 = the first SpAtk the client's table defines for a stance. This is
// a documented FLOOR, not a decode: see the header. Change it only with the
// letter->slot table in hand.
export const PHYS_SLOT = 'spAtk01';

// The dance slot is not a floor — the client's table names Social_dance as
// spAtk05 at all six stances on all 14 pawns, so a dance/song skill resolves
// through the same slot lookup as any other physical skill.
export const DANCE_SLOT = 'spAtk05';

/**
 * The whole cast, as retail structures it: a wind-up clip, a launch clip,
 * and a recovery clip, each with the phase keyframes its own sequence
 * carries.
 *
 *   entry    the skillanim.json row (anim code, magic, range)
 *   hitTime  MagicSkillUse cast duration in ms (0 = none: toggles)
 *
 * Returns { cast, launch, end, castShotU, launchShotU, source } where the
 * three clip fields may be null. `source` names which rule produced `cast`
 * so callers and suites can tell a decoded answer from the documented floor.
 *
 * The MAGIC branch:
 *   wind-up   castShort | castMid | castLong
 *   launch    magicThrow (a target) | magicNoTarget (self / no target)
 *   recovery  castEnd
 * Those five slot names, and their stance-invariance, are the client's.
 * WHICH of the three wind-ups a duration selects is NOT: the three clip
 * lengths are known exactly (0.833 s / ~1.833 s / 3.833 s) but the threshold
 * lives in packed native code, so `castClipForDuration` keeps the port's
 * existing cut-offs and flags itself `unsourced` in `source`.
 *
 * The PHYSICAL branch: one slot lookup, PHYS_SLOT, resolved per stance.
 */
export function castPlan(table, modelId, stance, entry, hitTime) {
  const out = { cast: null, launch: null, end: null,
                castShotU: null, launchShotU: null, source: 'none' };
  if (!table || !entry || !entry.anim) return out;      // passive/toggle
  const st = stance || 'hand';

  if (entry.magic === 3 || entry.anim === 'N' || entry.anim === 'W') {
    // dances (is_magic 3 / code N) and songs (code W): the client's own
    // spAtk05 row is Social_dance on every pawn and stance.
    out.cast = slotClip(table, modelId, DANCE_SLOT, st);
    out.source = 'slot:' + DANCE_SLOT;
  } else if (entry.magic === 0) {
    out.cast = slotClip(table, modelId, PHYS_SLOT, st);
    out.source = 'slot:' + PHYS_SLOT + ' (floor — letter->slot undecoded)';
  } else {
    const slot = castClipForDuration(hitTime);
    out.cast = slotClip(table, modelId, slot, st);
    out.source = 'slot:' + slot + ' (duration thresholds unsourced)';
    out.launch = slotClip(table, modelId,
                          entry.range === -1 || entry.range === 0
                            ? 'magicNoTarget' : 'magicThrow', st);
    out.end = slotClip(table, modelId, 'castEnd', st);
  }

  if (out.cast) {
    const s = notifyTimes(table, modelId, out.cast, 'AttackShot');
    if (s.length) out.castShotU = s[0];
  }
  if (out.launch) {
    const s = notifyTimes(table, modelId, out.launch, 'AttackShot');
    if (s.length) out.launchShotU = s[0];
  }
  return out;
}

/**
 * hitTime (ms) -> which of the three magic wind-up slots.
 *
 * UNSOURCED, deliberately unchanged from js/skillfx_anim.js's cut-offs so
 * this refactor does not smuggle in a new guess. What IS now measured is the
 * three clips' real lengths — castShort 0.833 s, castMid 1.833 s (2.333 s on
 * FOrc, 1.700 s on MShaman), castLong 3.833 s — which is what a future
 * decode has to be checked against.
 */
export function castClipForDuration(hitTime) {
  const s = hitTime != null ? hitTime / 1000 : 2;   // unknown: mid
  if (s < 1) return 'castShort';
  if (s < 5) return 'castMid';
  return 'castLong';
}

// aCis broadcasts MagicSkillLaunched this many ms BEFORE the cast ends.
// Measured on the live server, not read out of the Java: five skills in
// gateway/test/capture-skills.json, cast op -> launch op vs the cast's own
// hitTime — 1177 6253/5859, 1011 7816/7410, 1216 7816/7409, 4 800/402,
// 78 1200/812, 3 864/462. Every difference is 388-406 ms.
export const LAUNCH_LEAD_MS = 400;
