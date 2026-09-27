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
// The animation-code selector is now independently recovered from the original
// APawn::SetSkillAnim. It selects pawn slots by skillgrp.animation, regardless
// of the server's hitTime, is_magic or cast_range. The ordinary scheduler now
// consumes the exact source inputs below; native pose/effect parity is separate.

import { nativeSkillSlots } from './native-skillanim.js';
import { planNativeCastSchedule } from './native-castschedule.js';

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

/**
 * Resolve SetSkillAnim's original phase slots through this pawn's stance table.
 * `phases` preserves all source phases and missing clips in order. The ordinary
 * schedule below consumes original timing independently of these compatibility fields.
 * `launch` and `end` are compatibility fields for the original magic slot names.
 * In particular castEnd is an intermediate native phase, not a proven recovery.
 * hitTime remains accepted for callers but never changes slot selection.
 */
export function castPlan(table, modelId, stance, entry, hitTime) {
  const out = { cast: null, launch: null, end: null, phases: [],
                castShotU: null, launchShotU: null, source: 'none' };
  if (!table || !entry) return out;
  const slots = nativeSkillSlots(entry.anim);
  if (!slots) return out;
  const st = stance || 'hand';
  out.source = 'native:SetSkillAnim:' + entry.anim.toUpperCase();
  out.phases = slots.map(slot => {
    const clip = slotClip(table, modelId, slot, st);
    return { slot, clip, shotU: clip ? notifyTimes(table, modelId, clip, 'AttackShot') : [] };
  });
  out.cast = out.phases[0].clip;
  out.castShotU = out.phases[0].shotU[0] ?? null;
  const launch = out.phases.find(p => ['magicNoTarget', 'magicShot', 'magicThrow'].includes(p.slot));
  out.launch = launch?.clip ?? null;
  out.launchShotU = launch?.shotU[0] ?? null;
  out.end = out.phases.find(p => p.slot === 'castEnd')?.clip ?? null;
  return out;
}

/** Join only verified original timing to the ordinary native planner. */
export function castSchedule(table, modelId, stance, entry, { hitTimeMs, speedRate, agent } = {}) {
  if (table?.format !== 'l2-interlude-pawn-animation-v2' || !entry) {
    return { status: 'unsupported', reason: 'missing-original-timing' };
  }
  const plan = castPlan(table, modelId, stance, entry);
  const phases = [];
  for (const phase of plan.phases) {
    const info = clipInfo(table, modelId, phase.clip);
    if (!info?.originalTiming) return { status: 'unsupported', reason: 'missing-original-sequence', clip: phase.clip };
    phases.push({ ...phase, seq: info.seq, frames: info.frames, rate: info.rate, notifies: info.notifies });
  }
  return planNativeCastSchedule({ animation: entry.anim, style: entry.style,
    hitTimeMs, speedRate, agent, phases });
}

// aCis broadcasts MagicSkillLaunched this many ms BEFORE the cast ends.
// Measured on the live server, not read out of the Java: five skills in
// gateway/test/capture-skills.json, cast op -> launch op vs the cast's own
// hitTime — 1177 6253/5859, 1011 7816/7410, 1216 7816/7409, 4 800/402,
// 78 1200/812, 3 864/462. Every difference is 388-406 ms.
export const LAUNCH_LEAD_MS = 400;
