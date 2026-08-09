// ---------------------------------------------------------------------------
// WHAT A SKILL IS — kind, legal targets, and the numbers a player sees.
//
// Data: /gamedata/skillclass.json, written by tools/dat/export_skillclass.py.
// Read that file's header for the provenance of every field; the short form:
//
//   * `d` is the SysString id the RETAIL tooltip prints on the line under
//     "Lv N". It is not our label — Tooltip.uc:952 calls
//     UIDATA_SKILL.GetOperateType, whose native body (NWindow.dll 0x101b5880,
//     a plain PE) is a three-way branch on skillgrp's is_magic returning
//     SysString 311 'Active Skill' / 312 'Passive Skill' / 313 'Magic' /
//     1500 'Song/Dance'. The exporter reproduces that branch exactly.
//   * `k` (kind) and `t` (target) come from aCis — SkillType / SkillTargetType
//     plus the predicates the server itself branches on. The client has NO
//     target-type column anywhere in its 133 System files, which is why the
//     runtime cannot derive this on its own.
//   * refusal messages are the CLIENT's own decoded systemmsg-e.dat text,
//     keyed by the SystemMessageId each aCis target handler actually sends.
//
// This module is deliberately read-only and synchronous after load: the UI
// asks it questions, it never sends anything.
let _classData = null;      // resolved JSON, or null until the fetch lands
let _classPromise = null;

export function loadSkillClass() {
  if (_classPromise) return _classPromise;
  _classPromise = fetch('/gamedata/skillclass.json')
    .then(r => (r.ok ? r.json() : null))
    .then((j) => { _classData = j; return j; })
    .catch(() => { _classData = null; return null; });
  return _classPromise;
}

/** Resolved skillclass.json, or null while absent. Every accessor below
 *  degrades to null/undefined rather than guessing when it is missing. */
export function skillClassLoaded() { return _classData; }

/** Inject the JSON directly, for callers with no fetch (node suites, the
 *  offline path). Returns the data so `setSkillClassData(json)` reads as a
 *  load. */
export function setSkillClassData(json) {
  _classData = json;
  _classPromise = Promise.resolve(json);
  return json;
}

// The SystemMessageId numbers below are aCis's own (network/SystemMessageId.java
// `new SystemMessageId(N)`), and each is the one the matching target handler
// actually sends. The TEXT is never written here: it is looked up in the
// client's decoded systemmsg-e.dat (assets/gamedata/systemmsg.json), shipped
// inside skillclass.json as `msgs`.
const MSG_INVALID_TARGET = 109;          // aCis SystemMessageId.INVALID_TARGET
const MSG_CANNOT_USE_ON_YOURSELF = 51;   // aCis SystemMessageId.CANNOT_USE_ON_YOURSELF

export const SkillClass = {
  /** Raw record: {k,st,t,op,mg,d,off,dmg,deb,lv,n,cn,nm} or null. */
  get(id) {
    return (_classData && _classData.skills
      && _classData.skills[String(id)]) || null;
  },

  /** 'attack'|'heal'|'buff'|'debuff'|'resurrect'|'summon'|'dispel'|
   *  'toggle'|'passive'|'utility', or null when unknown. */
  kind(id) { const e = this.get(id); return (e && e.k) || null; },

  /** aCis SkillTargetType name ('SELF','ONE','AURA','GROUND',...) or null. */
  target(id) { const e = this.get(id); return (e && e.t) || null; },

  /** The target type's decoded semantics, or null. */
  targetInfo(id) {
    const t = this.target(id);
    return (t && _classData.targetTypes && _classData.targetTypes[t]) || null;
  },

  /** True when the server's own isOffensive() is set — the flag TargetOne
   *  branches on to decide whether a target is legal at all. */
  isOffensive(id) { const e = this.get(id); return !!(e && e.off); },

  /** True when the skill needs a target OBJECT before it can be sent. SELF,
   *  PARTY, AURA and friends resolve their own list server-side. */
  needsTarget(id) {
    const t = this.targetInfo(id);
    return t ? !!t.needsTarget : false;
  },

  /** True when this target type has no handler class on the server, so the
   *  cast is refused unconditionally. 51 shipped skills are in this state. */
  isUncastable(id) {
    const t = this.targetInfo(id);
    return t ? !t.handled : false;
  },

  /** The retail tooltip's operate-type line, e.g. 'Active Skill'. Comes from
   *  the decoded sysstring table, not from a literal here. */
  displayType(id) {
    const e = this.get(id);
    if (!e || e.d == null || !_classData.operateDisplay) return null;
    return _classData.operateDisplay[String(e.d)] || null;
  },

  /** Per-level number. Values are scalars when constant across levels and
   *  arrays otherwise; `level` is 1-based like skillgrp's skill_level.
   *  Fields: mp hp range cast reuse cool eff radius dur mpInit power item,
   *  plus mpSv/castSv/rangeSv/hpSv where the client .dat and the server
   *  disagree (both are kept; see the exporter header). */
  num(id, field, level = 1) {
    const e = this.get(id);
    const v = e && e.n ? e.n[field] : undefined;
    if (v === undefined) return null;
    if (!Array.isArray(v)) return v;
    return v[Math.min(Math.max(level, 1), v.length) - 1];
  },

  /** Every SystemMessageId this skill's target type can refuse with, with
   *  the condition and the CLIENT's own text. [] when unknown. */
  refusals(id) {
    const t = this.targetInfo(id);
    if (!t) return [];
    return t.refusals.map(r => ({
      msg: r.msg, when: r.when, text: this.msgText(r.msg),
    }));
  },

  /** Decoded systemmsg text for an id, or null. */
  msgText(msgId) {
    return (_classData && _classData.msgs
      && _classData.msgs[String(msgId)]) || null;
  },

  /** Would the server accept this cast against `targetKind`? Returns null
   *  when we cannot tell, else {ok} or {ok:false, msg, text}.
   *
   *  Only the checks that are decidable from what the client actually knows
   *  are implemented — the caller's target kind and the skill's own target
   *  type. Peace zones, party membership, clan, corpse decay and CTRL rules
   *  live on the server and are NOT second-guessed here.
   *
   *  targetKind: 'self' | 'player' | 'monster' | 'npc' | 'door' | 'corpse'
   *              | null (nothing targeted)
   */
  checkTarget(id, targetKind) {
    const e = this.get(id);
    const t = this.targetInfo(id);
    if (!e || !t) return null;
    if (!t.handled) return { ok: false, msg: MSG_INVALID_TARGET,
        text: this.msgText(MSG_INVALID_TARGET) };
    if (t.needsTarget && targetKind == null) {
      return { ok: false, msg: MSG_INVALID_TARGET,
        text: this.msgText(MSG_INVALID_TARGET) };
    }
    if (t.scope === 'corpse' && targetKind && targetKind !== 'corpse') {
      return { ok: false, msg: MSG_INVALID_TARGET,
        text: this.msgText(MSG_INVALID_TARGET) };
    }
    // TargetOne.meetCastConditions, transcribed: an offensive skill refuses
    // the caster and refuses a Folk/Guard without CTRL; a beneficial one
    // refuses a Monster without CTRL.
    if (t.scope === 'single' && e.t === 'ONE') {
      if (e.off && (targetKind === 'self' || targetKind === 'npc')) {
        return { ok: false, msg: MSG_INVALID_TARGET,
        text: this.msgText(MSG_INVALID_TARGET) };
      }
      if (!e.off && targetKind === 'monster') {
        return { ok: false, msg: MSG_INVALID_TARGET,
        text: this.msgText(MSG_INVALID_TARGET) };
      }
    }
    if (e.t === 'PARTY_OTHER' && targetKind === 'self') {
      return { ok: false, msg: MSG_CANNOT_USE_ON_YOURSELF,
        text: this.msgText(MSG_CANNOT_USE_ON_YOURSELF) };
    }
    if (e.t === 'UNLOCKABLE' && targetKind && targetKind !== 'door') {
      return { ok: false, msg: MSG_INVALID_TARGET,
        text: this.msgText(MSG_INVALID_TARGET) };
    }
    return { ok: true };
  },

  /** The whole decoded target-type table, for UI that wants to enumerate. */
  targetTypes() { return (_classData && _classData.targetTypes) || null; },
  kinds() { return (_classData && _classData.kinds) || null; },
};
