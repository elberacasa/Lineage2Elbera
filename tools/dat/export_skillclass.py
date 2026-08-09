#!/usr/bin/env python3
"""Decode WHAT EVERY SKILL IS: kind, legal targets, and the numbers a player sees.

The owner's question was: "what's a buff, heal, debuff, attack, self cast or
allies, and so on."  Nothing here is classified by NAME or by intuition.
Every field below cites where it was read from, and the two independent
sources (client .dat + server .xml) are joined so that every DISAGREEMENT
is counted rather than silently resolved.


=============================================================================
1. WHAT THE CLIENT ITSELF KNOWS  (assets/interlude/system/skillgrp.dat)
=============================================================================

skillgrp.dat carries 29,812 id x level records with 17 decoded columns
(tools/dat/extract_gamedata.py:parse_skillgrp).  Of those, exactly TWO carry
classification: `operate_type` and `is_magic`.  There is NO target-type
column and no weapon column (that was established in
tools/dat/export_skillweapons.py and re-confirmed here).

`operate_type` and `is_magic` were decoded FROM NWindow.dll, not guessed.
`UIDATA_SKILL.GetOperateType(classID, level)` (assets/uscript/NWindow/
UIDATA_SKILL.uc) is the function the retail tooltip calls -- Tooltip.uc:952
puts its return value on the line under "Lv N".  Its native implementation
is `?execGetOperateType@UUIDATA_SKILL@@...` at RVA 0x1298c0, which forwards
to the real getter at 0x101b5880.  NWindow.dll is a PLAIN PE (Engine.dll is
the Themida-packed one), so this disassembles:

    rec = lookup(classID, level)            ; 0x101b5360
    if (!rec) return ""
    v = rec->[0x3c]
    if (v == 0)  return SysString( rec->[0x20] == 2 ? +0x6b77c : +0x6b770 )
    if (v == 3)  return SysString( +0x6ef2c )
    else         return SysString( +0x6b788 )

The four operands are offsets into the SysString table whose stride is 12
bytes (`offset(id) = 0x6a8dc + id*12`, the standing key in docs/HANDOFF.md).
All four divide exactly:

    0x6b770 -> id 311  'Active Skill'
    0x6b77c -> id 312  'Passive Skill'
    0x6b788 -> id 313  'Magic'
    0x6ef2c -> id 1500 'Song/Dance'

(assets/gamedata/sysstring.json, the decoded sysstring-e.dat.)  Three of the
four are CONSECUTIVE ids -- 311/312/313 -- which is what makes the stride
reading a measurement rather than a coincidence.

So the field at +0x20 is the one whose value 2 means passive, and the field
at +0x3c is the one whose value 3 means song/dance.  Matching that against
the decoded columns:

  * `operate_type` takes exactly {0,1,2,3}; joining all 2,694 distinct ids
    against aCis's independent operateType gives 2 -> PASSIVE 739/742 and
    3 -> TOGGLE 31/32.  So +0x20 is operate_type, and the retail tooltip
    prints "Passive Skill" for operate_type == 2 and "Active Skill" for
    everything else.  NOTE THE TRAP the earlier wave already avoided: the
    intuitive "0 = passive" is backwards and would mislabel 929 skills.
  * `is_magic` takes exactly {0,1,3} -- value 2 never occurs in the file,
    and the disassembly's else-branch is what would catch it.  is_magic==3
    is 29 ids, and 27 of them are exactly the 27 skills aCis marks
    `isDance=true` (Song of Earth .. Dance of Light ..).  The other two are
    ids aCis does not ship at all.  So +0x3c is is_magic, and 3 = Song/Dance.

The A1/A2 split behind operate_type 0 vs 1 is REPORTED but not named:
cross-tabbed against aCis skillType, operate_type 0 is dominated by
instant-effect types (MDAM 152, PDAM 114, SUMMON 40, NEGATE 39, HEAL 39,
CREATE_ITEM 39) and operate_type 1 by types that apply a timed abnormal
(BUFF 490, DEBUFF 123, POISON 26, PARALYZE 22, ROOT 21, STUN 16).  This
script measures that split (`--report`) and ships the raw value; it does NOT
assert a name for it, because the client displays the same "Active Skill"
string for both and nothing in any readable client file distinguishes them.


=============================================================================
2. WHAT THE CLIENT DOES NOT KNOW -- and where it really lives
=============================================================================

There is no target type anywhere in the client's 133 System files.  In retail
the client sends RequestMagicSkillUse and the SERVER refuses with a specific
SystemMessage.  Those refusals are decoded here from the aCis handlers, and
the TEXT comes from the client's own decoded systemmsg-e.dat -- not invented:

    109  'Invalid target.'
    113  '$s1 cannot be used due to unsuitable terms.'
     51  'You cannot use this on yourself.'
     84  'You may not attack in a peaceful zone.'
     85  'You may not attack this target in a peaceful zone.'
    181  'Cannot see target.'
    343  'Sweeper failed, target not spoiled.'
    893  'The harvest failed because the seed was not sown.'
   1247  'The corpse is too old. The skill cannot be used.'
   1509  'You cannot use that skill in a Grand Olympiad Games match.'
     23  'Not enough HP.'      24 'Not enough MP.'
     48  '$s1 is not available at this time: being prepared for reuse.'

Server sources, all read for this export:
  enums/skills/SkillTargetType.java   the REAL target enum: 28 values
  enums/skills/SkillType.java         the REAL kind enum: 106 values
  handler/targethandlers/*.java       25 handlers = who a skill may hit, and
                                      which SystemMessageId each refusal sends
  skills/L2Skill.java                 isSkillTypeOffensive(), isDamage(),
                                      isAOE(), isCorpse* -- the predicates the
                                      server itself branches on
  data/xml/skills/*.xml               per-skill target/skillType/operateType
                                      plus the per-level number tables

Three of the 28 SkillTargetType values have NO handler class -- NONE, CORPSE,
ENEMY_SUMMON.  L2Skill.meetCastConditions returns FALSE for them and sends a
plain sendMessage (chat line, not a SystemMessage).  50 shipped skills carry
target NONE and 1 carries CORPSE, so those 51 are UNCASTABLE on this server.
That is recorded per skill as `handled: false`, not smoothed over.


=============================================================================
3. OUTPUT
=============================================================================

  assets/gamedata/skillclass.json

  {
    "source": {...},
    "targetTypes": { "<TARGET>": {scope, needsTarget, aoe, corpse, handled,
                                  allows[], refusals[{msg, when}]} },
    "kinds":       { "<kind>": {rule, label} },
    "msgs":        { "<id>": "<the client's own text>" },
    "skills": { "<id>": {
        "k":   kind          decoded (section 4)
        "st":  skillType     aCis raw, kept so nothing is lost
        "t":   target        aCis raw SkillTargetType name
        "op":  operate_type  client skillgrp.dat
        "mg":  is_magic      client skillgrp.dat
        "d":   display       the retail tooltip's own line (section 1)
        "off": offensive     aCis L2Skill.isOffensive()
        "dmg": isDamage      aCis L2Skill.isDamage()
        "deb": isDebuff
        "lv":  levels
        "n":   {mp,hp,range,cast,reuse,cool,eff,dur,item}  scalar, or a
               per-level array when the value actually varies
        "cn":  [msgId,...]   the <cond> refusal messages this skill declares
     } }
  }

  Per-level numbers are the CLIENT's for mp/hp/range/cast (that is what a
  retail tooltip prints) and the SERVER's for reuse/cool/effect-range/
  duration (the client has no column for those).  Where both exist the
  script counts disagreements instead of preferring one silently, and ships
  the server reading alongside as mpSv / castSv / rangeSv / hpSv.


=============================================================================
4. WHAT THE LIVE SERVER SAID  (gateway/test/capture-skills.json, 2026-08-09)
=============================================================================

Three things were checked against a real recording rather than reasoned about,
and one of them overturned a number this script first produced:

  * The SkillList packet's own `passive` boolean agrees with the NWindow
    operate_type decode for 11/11 skills in the capture -- including 194
    Lucky and 1320 Create Common Item (passive) against 226 Relax and 312
    Vicious Stance (toggles, which the boolean cannot distinguish).

  * `hitTime` / `reuseDelay` in this table are BASE values.  The number the
    player experiences is Formulas.calcAtkSpd -> time * 333 / (m)AtkSpd
    (skills/Formulas.java:771-776, applied at CreatureCast:108-110).  Every
    one of the six timed casts in the capture reproduces exactly:
    Power Strike 1080*333/416 = 864, Dash 1000*333/416 = 800,
    War Cry 1500*333/416 = 1200 (one pAtkSpd, 416, which is the charSheet's
    own), and Wind Strike 4000*333/213 = 6253, Heal / Self Heal
    5000*333/213 = 7816 (one mAtkSpd).  The cast bar must come from the
    MagicSkillUse packet, never from this file.

  * THE MP JOIN WAS WRONG AND THE LIVE SERVER SAID SO.  This script first
    compared skillgrp's `mp_consume` against aCis `mpConsume` and reported
    543 disagreements, with a suspicious 0.79-0.80 ratio on 309 of them.
    Wind Strike level 1 is skillgrp 9, aCis mpConsume 7 -- and aCis
    mpInitialConsume 2.  The client column is the TOTAL.  Against the sum the
    disagreement count is 179, and no systematic ratio survives.  The 0.80
    "signal" was an artefact of the join, not a fact about the data.

Usage:
  python3 tools/dat/export_skillclass.py [--check] [--report]
"""

import argparse
import collections
import json
import os
import sys
import xml.etree.ElementTree as ET

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_SKILLS = os.path.join(REPO,
                          "server/aCis_gameserver/build/dist/gameserver/data/xml/skills")
SRC_JAVA = os.path.join(REPO, "server/aCis_gameserver/java/net/sf/l2j/gameserver")
GAMEDATA = os.path.join(REPO, "assets/gamedata")
OUT = os.path.join(GAMEDATA, "skillclass.json")

# ---------------------------------------------------------------------------
# The NWindow.dll decode of UIDATA_SKILL::GetOperateType (see the header).
# Keyed by (is_magic, operate_type); the value is the SysString id the retail
# tooltip prints, so it can be re-resolved against sysstring.json rather than
# hardcoding the English text here.
OPERATE_SYSSTRING = {"active": 311, "passive": 312, "magic": 313, "dance": 1500}


# skillgrp.dat column values the NWindow.dll branch compares against.
PASSIVE_OPERATE_TYPE = 2   # skillgrp operate_type, cmp at NWindow 0x101b5903
DANCE_IS_MAGIC = 3         # skillgrp is_magic, cmp at NWindow 0x101b58ca


def display_sysstring(is_magic, operate_type):
    """Reproduce NWindow.dll 0x101b5880 exactly (decoded, see the header)."""
    if is_magic == 0:
        return OPERATE_SYSSTRING["passive"] \
            if operate_type == PASSIVE_OPERATE_TYPE \
            else OPERATE_SYSSTRING["active"]
    if is_magic == DANCE_IS_MAGIC:
        return OPERATE_SYSSTRING["dance"]
    return OPERATE_SYSSTRING["magic"]


# ---------------------------------------------------------------------------
# Predicates transcribed 1:1 from the server source.  Each set is a literal
# copy of a `switch` in L2Skill.java; the --check re-reads the .java and FAILS
# if the source list and the set here ever diverge.
OFFENSIVE_TYPES = {  # L2Skill.isSkillTypeOffensive()
    "PDAM", "MDAM", "CPDAMPERCENT", "DOT", "BLEED", "POISON", "AGGDAMAGE",
    "DEBUFF", "AGGDEBUFF", "STUN", "ROOT", "CONFUSION", "ERASE", "BLOW",
    "FATAL", "FEAR", "DRAIN", "SLEEP", "CHARGEDAM", "DEATHLINK", "MANADAM",
    "MDOT", "MUTE", "SOULSHOT", "SPIRITSHOT", "SPOIL", "WEAKNESS", "SWEEP",
    "PARALYZE", "DRAIN_SOUL", "AGGREDUCE", "CANCEL", "MAGE_BANE",
    "WARRIOR_BANE", "AGGREMOVE", "AGGREDUCE_CHAR", "BEAST_FEED", "BETRAY",
    "DELUXE_KEY_UNLOCK", "SOW", "HARVEST", "INSTANT_JUMP",
}
DAMAGE_TYPES = {  # L2Skill.isDamage()
    "PDAM", "MDAM", "DRAIN", "BLOW", "CPDAMPERCENT", "DEATHLINK",
    "CHARGEDAM", "FATAL", "SIGNET_CASTTIME",
}
AOE_TARGETS = {  # L2Skill.isAOE()
    "AREA", "AURA", "BEHIND_AURA", "FRONT_AREA", "FRONT_AURA",
    "AURA_UNDEAD", "AREA_SUMMON", "AREA_CORPSE_MOB",
}
CORPSE_TARGETS = {  # L2Skill.isCorpseType()
    "AREA_CORPSE_MOB", "CORPSE", "CORPSE_MOB", "CORPSE_PET",
    "CORPSE_PLAYER", "CORPSE_ALLY",
}
# The 25 classes present in handler/targethandlers/.  A target type with no
# handler cannot be cast at all (L2Skill.meetCastConditions returns false).
HANDLED_TARGETS = {
    "ALLY", "AREA", "AREA_CORPSE_MOB", "AREA_SUMMON", "AURA", "AURA_UNDEAD",
    "BEHIND_AURA", "CLAN", "CORPSE_ALLY", "CORPSE_MOB", "CORPSE_PET",
    "CORPSE_PLAYER", "FRONT_AREA", "FRONT_AURA", "GROUND", "HOLY", "ONE",
    "OWNER_PET", "PARTY", "PARTY_MEMBER", "PARTY_OTHER", "SELF", "SUMMON",
    "UNDEAD", "UNLOCKABLE",
}

# ---------------------------------------------------------------------------
# SystemMessageId ids exactly as aCis declares them in
# network/SystemMessageId.java (`NAME = new SystemMessageId(N)`).  Each one
# below is a message some targethandler actually sends; the TEXT is never
# written here, it is resolved from the client's own decoded systemmsg-e.dat
# (assets/gamedata/systemmsg.json) when the file is written.
MSG_NOT_ENOUGH_HP = 23           # aCis SystemMessageId.NOT_ENOUGH_HP
MSG_NOT_ENOUGH_MP = 24           # aCis SystemMessageId.NOT_ENOUGH_MP
MSG_PREPARED_FOR_REUSE = 48      # aCis SystemMessageId.S1_PREPARED_FOR_REUSE
MSG_CANNOT_USE_ON_YOURSELF = 51  # aCis SystemMessageId.CANNOT_USE_ON_YOURSELF
MSG_CANT_ATK_PEACEZONE = 84      # aCis SystemMessageId.CANT_ATK_PEACEZONE
MSG_TARGET_IN_PEACEZONE = 85     # aCis SystemMessageId.TARGET_IN_PEACEZONE
MSG_INVALID_TARGET = 109         # aCis SystemMessageId.INVALID_TARGET
MSG_S1_CANNOT_BE_USED = 113      # aCis SystemMessageId.S1_CANNOT_BE_USED
MSG_COND_DEFAULT = 129           # aCis <cond msgId> default in the skill XML
MSG_CANT_SEE_TARGET = 181        # aCis SystemMessageId.CANT_SEE_TARGET
MSG_SWEEPER_FAILED = 343         # aCis SystemMessageId.SWEEPER_FAILED_TARGET_NOT_SPOILED
MSG_HARVEST_FAILED = 893         # aCis SystemMessageId.THE_HARVEST_FAILED...
MSG_CORPSE_TOO_OLD = 1247        # aCis SystemMessageId.CORPSE_TOO_OLD_SKILL_NOT_USED
MSG_OLYMPIAD_SKILL = 1509        # aCis SystemMessageId.THIS_SKILL_IS_NOT_AVAILABLE...

# ---------------------------------------------------------------------------
# Target semantics, transcribed from each handler's getTargetList() +
# meetCastConditions().  `refusals` lists the SystemMessageId ids that handler
# can actually send, with the condition that triggers each -- the text is
# resolved from the client's own systemmsg.json at write time.
TARGET_TYPES = {
    "SELF":  dict(scope="self", needsTarget=False,
                  allows=["caster"],
                  refusals=[]),
    "ONE":   dict(scope="single", needsTarget=True,
                  allows=["enemy if the skill is offensive, otherwise any "
                          "playable; monsters only with CTRL"],
                  refusals=[(MSG_INVALID_TARGET, "offensive and the target is dead, is the "
                                  "caster, is a Folk/Guard without CTRL, or an "
                                  "unattackable Door; beneficial and the target "
                                  "is a Monster without CTRL"),
                            (MSG_CANT_ATK_PEACEZONE, "offensive, caster inside a peace zone"),
                            (MSG_TARGET_IN_PEACEZONE, "offensive, target inside a peace zone")]),
    "PARTY": dict(scope="party", needsTarget=False,
                  allows=["every party member in skillRadius, plus their summons"],
                  refusals=[]),
    "ALLY":  dict(scope="alliance", needsTarget=False,
                  allows=["caster, own summon, and every clan/ally playable in "
                          "skillRadius"],
                  refusals=[]),
    "CLAN":  dict(scope="clan", needsTarget=False,
                  allows=["NPC-only on aCis: the handler does nothing unless the "
                          "caster is an Attackable"],
                  refusals=[]),
    "AREA":  dict(scope="area_target", needsTarget=True,
                  allows=["everything attackable within skillRadius of the TARGET"],
                  refusals=[(MSG_INVALID_TARGET, "no target, or the target is the caster / dead")]),
    "FRONT_AREA": dict(scope="area_target", needsTarget=True,
                       allows=["as AREA, restricted to creatures in front of the caster"],
                       refusals=[(MSG_INVALID_TARGET, "no target, or the target is the caster / dead")]),
    "AURA":  dict(scope="area_self", needsTarget=False,
                  allows=["everything attackable within skillRadius of the CASTER"],
                  refusals=[(MSG_CANT_ATK_PEACEZONE, "offensive, caster inside a peace zone")]),
    "FRONT_AURA": dict(scope="area_self", needsTarget=False,
                       allows=["as AURA, restricted to creatures in front of the caster"],
                       refusals=[(MSG_CANT_ATK_PEACEZONE, "offensive, caster inside a peace zone")]),
    "BEHIND_AURA": dict(scope="area_self", needsTarget=False,
                        allows=["as AURA, restricted to creatures behind the caster"],
                        refusals=[(MSG_CANT_ATK_PEACEZONE, "offensive, caster inside a peace zone")]),
    "AURA_UNDEAD": dict(scope="area_self", needsTarget=False,
                        allows=["as AURA, undead only"],
                        refusals=[(MSG_CANT_ATK_PEACEZONE, "offensive, caster inside a peace zone")]),
    "UNDEAD": dict(scope="single", needsTarget=True,
                   allows=["one living undead Monster or Servitor"],
                   refusals=[(MSG_INVALID_TARGET, "target is not a Monster/Servitor, or is dead"),
                             (MSG_S1_CANNOT_BE_USED, "target is alive but not undead")]),
    "HOLY":  dict(scope="single", needsTarget=True,
                  allows=["a siege HolyThing (the castle artifact)"],
                  refusals=[(MSG_INVALID_TARGET, "the target is not a HolyThing")]),
    "UNLOCKABLE": dict(scope="single", needsTarget=True,
                       allows=["a Door or a Chest"],
                       refusals=[(MSG_INVALID_TARGET, "target is neither a Door nor a Chest")]),
    "CORPSE": dict(scope="corpse", needsTarget=True,
                   allows=["-- no handler class exists; the cast is refused"],
                   refusals=[]),
    "CORPSE_MOB": dict(scope="corpse", needsTarget=True,
                       allows=["the corpse of a Monster (never a Pet)"],
                       refusals=[(MSG_INVALID_TARGET, "no corpse is decaying, or the target is a Pet"),
                                 (MSG_CORPSE_TOO_OLD, "the corpse is past half its decay time and "
                                        "is neither seeded nor spoiled"),
                                 (MSG_SWEEPER_FAILED, "SWEEP and the target is not a Monster"),
                                 (MSG_HARVEST_FAILED, "HARVEST and the target is not a Monster")]),
    "AREA_CORPSE_MOB": dict(scope="corpse", needsTarget=True,
                            allows=["as CORPSE_MOB, then everything in skillRadius"],
                            refusals=[(MSG_INVALID_TARGET, "no corpse is decaying, or the target is a Pet"),
                                      (MSG_CORPSE_TOO_OLD, "the corpse is past half its decay time"),
                                      (MSG_SWEEPER_FAILED, "SWEEP and the target is not a Monster"),
                                      (MSG_HARVEST_FAILED, "HARVEST and the target is not a Monster")]),
    "CORPSE_PLAYER": dict(scope="corpse", needsTarget=True,
                          allows=["the corpse of a Playable"],
                          refusals=[(MSG_INVALID_TARGET, "the target is not dead"),
                                    (MSG_S1_CANNOT_BE_USED, "the dead target is not a Playable")]),
    "CORPSE_PET": dict(scope="corpse", needsTarget=True,
                       allows=["the corpse of the caster's own Pet"],
                       refusals=[(MSG_INVALID_TARGET, "the target is not dead"),
                                 (MSG_S1_CANNOT_BE_USED, "the dead target is not the caster's Pet")]),
    "CORPSE_ALLY": dict(scope="corpse", needsTarget=False,
                        allows=["dead clan/ally members in skillRadius"],
                        refusals=[(MSG_OLYMPIAD_SKILL, "in a Grand Olympiad match")]),
    "PARTY_MEMBER": dict(scope="single", needsTarget=True,
                         allows=["the caster, the caster's summon, or one living "
                                 "Playable in the same party"],
                         refusals=[(MSG_S1_CANNOT_BE_USED, "the target is dead, is not a Playable, or "
                                         "is not in the caster's party")]),
    "PARTY_OTHER": dict(scope="single", needsTarget=True,
                        allows=["one living Player in the same party, NOT the caster"],
                        refusals=[(MSG_CANNOT_USE_ON_YOURSELF, "the target is the caster"),
                                  (MSG_INVALID_TARGET, "the target is not a Player, or is dead"),
                                  (MSG_S1_CANNOT_BE_USED, "skill 426 on a mage / 427 on a fighter, or "
                                        "the target is not in the caster's party")]),
    "SUMMON": dict(scope="summon", needsTarget=False,
                   allows=["the caster's own living summon"],
                   refusals=[(MSG_INVALID_TARGET, "the caster has no summon, or it is dead")]),
    "AREA_SUMMON": dict(scope="area_summon", needsTarget=False,
                        allows=["everything in skillRadius around the caster's summon"],
                        refusals=[]),
    "ENEMY_SUMMON": dict(scope="summon", needsTarget=True,
                         allows=["-- no handler class exists; the cast is refused"],
                         refusals=[]),
    "OWNER_PET": dict(scope="owner", needsTarget=True,
                      allows=["the summon's own owner (these are pet skills)"],
                      refusals=[(MSG_INVALID_TARGET, "the caster is not a Summon, or the target is "
                                      "not its owner"),
                                (MSG_S1_CANNOT_BE_USED, "the owner is dead")]),
    "GROUND": dict(scope="ground", needsTarget=False,
                   allows=["a ground location the caster picked (signets)"],
                   refusals=[(MSG_CANT_SEE_TARGET, "the picked location is not in line of sight"),
                             (MSG_S1_CANNOT_BE_USED, "the effect radius would reach into a peace zone")]),
    "NONE": dict(scope="none", needsTarget=False,
                 allows=["-- no handler class exists; the cast is refused"],
                 refusals=[]),
}

# ---------------------------------------------------------------------------
# KIND.  Every rule fires on a SERVER enum value or a SERVER predicate; the
# rule that fired is shipped with the skill so no mapping is anonymous.
# Rules are tried in order.
KIND_RULES = [
    ("passive",   "operateType == PASSIVE"),
    ("toggle",    "operateType == TOGGLE"),
    ("resurrect", "skillType RESURRECT"),
    ("summon",    "skillType SUMMON / SPAWN / SUMMON_CREATURE / SIEGE_FLAG / "
                  "SUMMON_FRIEND / SUMMON_PARTY"),
    ("dispel",    "skillType CANCEL / CANCEL_DEBUFF / NEGATE / MAGE_BANE / "
                  "WARRIOR_BANE / AGGREMOVE"),
    ("heal",      "SkillType.java section '// hp, mp, cp'"),
    ("utility",   "SkillType.java sections '// MISC' / '// Fishing' / "
                  "'// Creation' -- aCis's own grouping for the non-combat "
                  "types (unlock, enchant, shots, sow/harvest, craft, "
                  "extract, fishing)"),
    ("attack",    "L2Skill.isDamage()"),
    ("debuff",    "L2Skill.isSkillTypeOffensive() or isDebuff()"),
    ("buff",      "skillType BUFF / CONT"),
    ("other",     "everything else that is still an ACTIVE skill"),
]
KIND_RESURRECT = {"RESURRECT"}
KIND_SUMMON = {"SUMMON", "SPAWN", "SUMMON_CREATURE", "SIEGE_FLAG",
               "SUMMON_FRIEND", "SUMMON_PARTY"}
KIND_DISPEL = {"CANCEL", "CANCEL_DEBUFF", "NEGATE", "MAGE_BANE",
               "WARRIOR_BANE", "AGGREMOVE"}
# literal copy of the "// hp, mp, cp" section of SkillType.java; --check
# re-reads that section from source and fails on divergence
KIND_HEAL = {"HEAL", "MANAHEAL", "COMBATPOINTHEAL", "HOT", "MPHOT",
             "BALANCE_LIFE", "HEAL_STATIC", "MANARECHARGE", "HEAL_PERCENT",
             "MANAHEAL_PERCENT"}
KIND_BUFF = {"BUFF", "CONT"}
# literal copies of three more labelled sections of SkillType.java; --check
# re-reads each from source and fails on divergence
KIND_MISC = {"UNLOCK", "UNLOCK_SPECIAL", "DELUXE_KEY_UNLOCK", "ENCHANT_ARMOR",
             "ENCHANT_WEAPON", "SOULSHOT", "SPIRITSHOT", "SIEGE_FLAG",
             "TAKE_CASTLE", "SOW", "HARVEST", "GET_PLAYER", "DUMMY",
             "INSTANT_JUMP"}
KIND_FISHING = {"FISHING", "PUMPING", "REELING"}
KIND_CREATION = {"COMMON_CRAFT", "DWARVEN_CRAFT", "CREATE_ITEM",
                 "EXTRACTABLE", "EXTRACTABLE_FISH"}
KIND_UTILITY = KIND_MISC | KIND_FISHING | KIND_CREATION
# SIEGE_FLAG is in '// MISC' but is also a summon; the summon rule runs first
# and wins, which is why KIND_SUMMON keeps it.

# The kinds whose skillType sits in a section aCis LABELS as hostile. Anything
# that reaches the 'debuff' rule from outside these is flagged `kw` (kind-weak)
# in the output: the server calls it offensive, but it is not in a labelled
# combat section and no readable source says what a player should call it.
# Measured residue: SPOIL, SWEEP, BEAST_FEED, BETRAY, ERASE, DRAIN_SOUL.
KIND_HOSTILE_SECTIONS = ({"DEBUFF"}
                         | {"PDAM", "FATAL", "MDAM", "CPDAMPERCENT", "MANADAM",
                            "DOT", "MDOT", "DRAIN_SOUL", "DRAIN", "DEATHLINK",
                            "BLOW", "SIGNET", "SIGNET_CASTTIME", "SEED",
                            "REAL_DAMAGE"}
                         | {"BLEED", "POISON", "STUN", "ROOT", "CONFUSION",
                            "FEAR", "SLEEP", "MUTE", "PARALYZE", "WEAKNESS"}
                         | {"AGGDAMAGE", "AGGREDUCE", "AGGREMOVE",
                            "AGGREDUCE_CHAR", "AGGDEBUFF"})


def classify(skill_type, operate_type, is_debuff):
    if operate_type == "PASSIVE":
        return "passive", KIND_RULES[0][1]
    if operate_type == "TOGGLE":
        return "toggle", KIND_RULES[1][1]
    if skill_type in KIND_RESURRECT:
        return "resurrect", KIND_RULES[2][1]
    if skill_type in KIND_SUMMON:
        return "summon", KIND_RULES[3][1]
    if skill_type in KIND_DISPEL:
        return "dispel", KIND_RULES[4][1]
    if skill_type in KIND_HEAL:
        return "heal", KIND_RULES[5][1]
    if skill_type in KIND_UTILITY:
        return "utility", KIND_RULES[6][1]
    if skill_type in DAMAGE_TYPES:
        return "attack", KIND_RULES[7][1]
    if skill_type in OFFENSIVE_TYPES or is_debuff:
        return "debuff", KIND_RULES[8][1]
    if skill_type in KIND_BUFF:
        return "buff", KIND_RULES[9][1]
    return "other", KIND_RULES[10][1]


# ---------------------------------------------------------------------------
# WHAT COULD NOT BE DECODED.  Measured facts about each field are recorded;
# the MEANING is what is missing.  Nothing here is guessed at.
UNDECODED = [
    {"field": "skillgrp.cast_style",
     "measured": "15 distinct values 0-14 over 29,812 rows; cross-tabs against "
                 "is_magic (cast_style 1 covers 12,273 magic AND 3,871 physical "
                 "rows) and against aCis weaponsAllowed both fail to separate. "
                 "cast_style 3 covers Power Strike (sword) and Mortal Blow "
                 "(dagger) alike, so it is not a weapon mask.",
     "missing": "no client file names the enum. Not in Tooltip.uc, not in "
                "UIDATA_SKILL.uc, no NWindow.dll export reads it."},
    {"field": "skillgrp.extra_eff",
     "measured": "boolean, 7,200 rows set. Independent of is_enchanted "
                 "(3,660 base rows and 3,540 enchant rows carry it).",
     "missing": "nothing in the readable client reads the column."},
    {"field": "skillgrp.rumble_self / rumble_target",
     "measured": "small enums {8,9,13,14,-1} and {0,10,11,-1}; -1 is by far the "
                 "commonest and the pairs are strongly correlated (9/11 on "
                 "9,245 rows, 8/10 on 8,366).",
     "missing": "no reader found. The NAME suggests force feedback; that is an "
                "inference from the column name and is not evidence."},
    {"field": "skillgrp.operate_type 0 vs 1",
     "measured": "both are ACTIVE to aCis and both print SysString 311 "
                 "'Active Skill' through NWindow's own branch. Cross-tabbed "
                 "against aCis skillType, 0 leans instant (MDAM 152, PDAM 114, "
                 "SUMMON 40, NEGATE 39, HEAL 39) and 1 leans timed-abnormal "
                 "(BUFF 490, DEBUFF 123, POISON 26, PARALYZE 22).",
     "missing": "no client file distinguishes them, so the widely-repeated "
                "'A1 / A2' naming is not sourced here and is not asserted."},
    {"field": "skillgrp.animation letter -> special-attack slot",
     "measured": "known open from the cast-animation wave; 363 skills collapse "
                 "onto one clip.",
     "missing": "the letter-to-slot table is absent from every readable client "
                "file (see tools/anim/build_pawnanim.py)."},
    {"field": "aCis skillType NOTDONE / COREDONE / DUMMY",
     "measured": "56 + 6 + 42 skills. These are SERVER placeholders, not client "
                 "data: NOTDONE means aCis has not implemented the skill.",
     "missing": "what retail actually does for them. The client's own tables "
                "carry no behaviour, so there is nothing here to decode."},
    {"field": "kind for the 96 'other' skills",
     "measured": "CHANGE_APPEARANCE 28, NOTDONE 17, RECALL 15, SIGNET 9, "
                 "REFLECT 5, FUSION 5, FEED_PET 5, SEED 3, ...",
     "missing": "aCis files these in no labelled section of SkillType.java, so "
                "no source says what a player should call them."},
    {"field": "kind for the 9 'kind-weak' skills",
     "measured": "SWEEP 2, SPOIL 2, BEAST_FEED 2, BETRAY 1, ERASE 1, BUFF 1. "
                 "aCis isSkillTypeOffensive() returns true for them, so they "
                 "land in the debuff bucket.",
     "missing": "they are looting / feeding / mind-control actions, not "
                "abnormal-applying debuffs, and nothing in the data says so. "
                "Flagged per-skill as `kw` rather than silently bucketed."},
]


def load(name):
    with open(os.path.join(GAMEDATA, name)) as f:
        return json.load(f)


def parse_java_switch(path, method):
    """Pull the `case X:` labels out of one method body, so the transcribed
    sets above can be checked against the source instead of trusted."""
    text = open(path, encoding="utf-8").read()
    i = text.find(method)
    if i < 0:
        return None
    j = text.find("switch", i)
    k = text.find("default", j)
    if k < 0:
        k = text.find("\n\t}", j)
    body = text[j:k]
    return {ln.strip()[5:-1] for ln in body.splitlines()
            if ln.strip().startswith("case ")}


def parse_java_section(path, header, stop_header):
    """The enum names between two `// comment` markers in SkillType.java."""
    text = open(path, encoding="utf-8").read()
    i = text.find(header)
    j = text.find(stop_header, i + 1)
    out = set()
    for ln in text[i + len(header):j].splitlines():
        ln = ln.strip().rstrip(",")
        # entries may carry a constructor argument: SIEGE_FLAG(L2SkillSiegeFlag.class)
        if "(" in ln:
            ln = ln[:ln.index("(")]
        if ln and not ln.startswith("//") and ln.replace("_", "").isalnum():
            out.add(ln)
    return out


def resolve(val, tables, level, levels):
    """A <set val=...> is either a scalar or a '#table' reference."""
    if val is None:
        return None
    if val.startswith("#"):
        t = tables.get(val)
        if not t:
            return None
        return t[level] if level < len(t) else t[-1]
    return val


def num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return int(f) if f == int(f) else round(f, 4)


def collapse(seq):
    """[5,5,5] -> 5 ; [1,2,3] -> [1,2,3] ; [None,...] -> None."""
    if not seq or all(v is None for v in seq):
        return None
    if all(v == seq[0] for v in seq):
        return seq[0]
    return seq


def parse_server():
    """{id: {levels, target, skillType, operateType, isDebuff, offensiveOverride,
             isDance, per-level number lists, cond msgIds}}"""
    out = {}
    for fn in sorted(os.listdir(SRC_SKILLS)):
        if not fn.endswith(".xml"):
            continue
        root = ET.parse(os.path.join(SRC_SKILLS, fn)).getroot()
        for sk in root.findall("skill"):
            sid = int(sk.get("id"))
            levels = int(sk.get("levels", "1"))
            tables = {}
            for t in sk.findall("table"):
                tables[t.get("name")] = (t.text or "").split()
            sets = {s.get("name"): s.get("val") for s in sk.findall("set")}

            def per_level(key, cast=num):
                raw = sets.get(key)
                if raw is None:
                    return None
                return collapse([cast(resolve(raw, tables, i, levels))
                                 for i in range(levels)])

            # effect duration: <for><effect time="N"> in seconds
            durs = []
            for f in sk.findall("for"):
                for e in f.findall("effect"):
                    t = e.get("time")
                    if t is None:
                        continue
                    durs.append(collapse([num(resolve(t, tables, i, levels))
                                          for i in range(levels)]))
            dur = None
            for d in durs:
                if d is None:
                    continue
                dur = d if dur is None else (
                    d if _maxof(d) > _maxof(dur) else dur)

            # A few skills give skillType / isDebuff a per-level TABLE rather
            # than a scalar (5008 Frintezza's Songs is BUFF BUFF BUFF BUFF
            # CANCEL). Resolve the reference; the level-1 value is what the
            # classification uses, and `stVaries` records that it changes.
            def scalar(key):
                v = sets.get(key)
                if v is None or not v.startswith("#"):
                    return v
                t = tables.get(v)
                return t[0] if t else None

            st_levels = None
            if (sets.get("skillType") or "").startswith("#"):
                st_levels = tables.get(sets["skillType"])

            out[sid] = {
                "levels": levels,
                "name": sk.get("name"),
                "target": scalar("target"),
                "skillType": scalar("skillType"),
                "skillTypeLevels": st_levels,
                "operateType": scalar("operateType"),
                "isDebuff": scalar("isDebuff") == "true",
                "isDance": sets.get("isDance") == "true",
                "isMagic": sets.get("isMagic"),
                "offensiveSet": sets.get("offensive"),
                "mp": per_level("mpConsume"),
                "mpInit": per_level("mpInitialConsume"),
                "hp": per_level("hpConsume"),
                "range": per_level("castRange"),
                "eff": per_level("effectRange"),
                "radius": per_level("skillRadius"),
                "cast": per_level("hitTime"),
                "cool": per_level("coolTime"),
                "reuse": per_level("reuseDelay"),
                "power": per_level("power"),
                "itemId": per_level("itemConsumeId"),
                "itemCount": per_level("itemConsumeCount"),
                "dur": dur,
                "cond": sorted({int(c.get("msgId")) for c in sk.findall("cond")
                                if c.get("msgId")}),
            }
    return out


def _maxof(v):
    return max(v) if isinstance(v, list) else v


def _sum_levels(a, b, levels):
    """mpConsume + mpInitialConsume, either of which may be a scalar, a
    per-level list, or absent."""
    if a is None and b is None:
        return None
    la = a if isinstance(a, list) else [a if a is not None else 0] * levels
    lb = b if isinstance(b, list) else [b if b is not None else 0] * levels
    n = max(len(la), len(lb))
    out = [(la[min(i, len(la) - 1)] or 0) + (lb[min(i, len(lb) - 1)] or 0)
           for i in range(n)]
    return collapse(out)


def _same(a, b):
    """Compare a client array against a server array over the levels both
    actually define.  The two ladders can differ in LENGTH legitimately (the
    client ships enchant rows and, for a few ids, more base levels than the
    datapack implements); a length difference alone is not a disagreement in
    the VALUES, so only the shared prefix is compared."""
    la = a if isinstance(a, list) else None
    lb = b if isinstance(b, list) else None
    if la is None and lb is None:
        return a == b
    if la is None:
        return all(v == a for v in lb)
    if lb is None:
        return all(v == b for v in la)
    n = min(len(la), len(lb))
    return la[:n] == lb[:n]


def _i32(v):
    return v - 0x100000000 if v >= 0x80000000 else v


def parse_client():
    """{id: {levels, per-level lists from skillgrp.dat}}

    skillgrp.dat stores the ENCHANT routes in the same table as the base
    levels: skill 1 has 97 rows numbered 1..37 and 101..130 / 201..230.
    Its own `is_enchanted` column separates them (37 rows carry 0, and 37 is
    exactly the server's levels="37"), so the base ladder is the
    is_enchanted == 0 rows.  Comparing the raw 97-row array against the
    server's 37 is what makes an identical skill look like a disagreement.
    """
    grp = load("skillgrp.json")
    by_id = collections.defaultdict(dict)
    ench = collections.Counter()
    for r in grp:
        if r["is_enchanted"]:
            ench[r["skill_id"]] += 1
            continue
        by_id[r["skill_id"]][r["skill_level"]] = r
    out = {}
    for sid, lv in by_id.items():
        order = sorted(lv)
        rows = [lv[i] for i in order]
        out[sid] = {
            "levels": len(order),
            "ench": ench.get(sid, 0),
            "op": collapse([r["operate_type"] for r in rows]),
            "mg": collapse([r["is_magic"] for r in rows]),
            "mp": collapse([r["mp_consume"] for r in rows]),
            "hp": collapse([r["hp_consume"] for r in rows]),
            # skillgrp's cast_range column is SIGNED and the extractor reads
            # it as u32, so "no range" arrives as 0xffffffff and Summon
            # Friend's -2 as 0xfffffffe. Sign-convert the whole column rather
            # than special-casing -1: 0xfffffffe really is in the file.
            "range": collapse([_i32(r["cast_range"]) for r in rows]),
            # hit_time is SECONDS in the .dat and MILLISECONDS in the server XML
            "cast": collapse([int(round(r["hit_time"] * 1000)) for r in rows]),
        }
    return out


def build():
    server = parse_server()
    client = parse_client()
    sysmsg = load("systemmsg.json")
    sysstring = {r["id"]: r["string"] for r in load("sysstring.json")}
    names = {}
    for r in load("skillname.json"):
        names.setdefault(r["skill_id"], r["name"])

    ids = sorted(set(server) | set(client))
    skills = {}
    dis = collections.Counter()
    dis_detail = collections.defaultdict(list)
    kinds = collections.Counter()
    targets = collections.Counter()
    unclassified = []
    weak = []

    for sid in ids:
        s = server.get(sid)
        c = client.get(sid)
        entry = {}
        if c:
            op, mg = c["op"], c["mg"]
            # a handful of ids change operate_type/is_magic across levels;
            # keep the list, and use the first level for the display string
            op0 = op[0] if isinstance(op, list) else op
            mg0 = mg[0] if isinstance(mg, list) else mg
            entry["op"] = op
            entry["mg"] = mg
            entry["d"] = display_sysstring(mg0, op0)
            entry["lv"] = c["levels"]
            if c["ench"]:
                entry["ench"] = c["ench"]
        if s:
            st = s["skillType"]
            tgt = s["target"]
            offensive = (s["offensiveSet"] == "true" if s["offensiveSet"]
                         else (st in OFFENSIVE_TYPES or s["isDebuff"]
                               or tgt == "CORPSE_MOB"))
            kind, rule = classify(st, s["operateType"], s["isDebuff"])
            entry.update({
                "k": kind,
                "st": st,
                "t": tgt,
                "off": 1 if offensive else 0,
                "dmg": 1 if st in DAMAGE_TYPES else 0,
                "deb": 1 if s["isDebuff"] else 0,
                "sv": s["operateType"],
            })
            if s["skillTypeLevels"] and len(set(s["skillTypeLevels"])) > 1:
                # the skillType itself changes with level; ship the ladder
                entry["stLv"] = s["skillTypeLevels"]
            if not c:
                entry["lv"] = s["levels"]
            n = {}
            # client-first for what the retail tooltip prints.
            #
            # THE MP JOIN IS NOT mp_consume vs mpConsume. Verified against the
            # live server (gateway/test/capture-skills.json, 2026-08-09):
            # Wind Strike level 1 is skillgrp mp_consume = 9, and aCis carries
            # mpInitialConsume = 2 + mpConsume = 7. The client column is the
            # TOTAL. Comparing it against mpConsume alone reported 543
            # "disagreements" that were an artefact of the join; the real
            # figure against the sum is far smaller.
            srv_mp = _sum_levels(s["mp"], s["mpInit"], s["levels"])
            for key, ck, skey in (("mp", "mp", None), ("hp", "hp", "hp"),
                                  ("range", "range", "range"),
                                  ("cast", "cast", "cast")):
                cv = c[ck] if c else None
                sv = srv_mp if key == "mp" else s[skey]
                if cv is not None:
                    n[key] = cv
                elif sv is not None:
                    n[key] = sv
                if cv is not None and sv is not None and not _same(cv, sv):
                    dis[key] += 1
                    dis_detail[key].append(sid)
                    # Both readings are kept. The CLIENT value is what the
                    # retail tooltip prints (Tooltip.uc -> UIDATA_SKILL::
                    # GetMpConsume / GetCastRange, straight out of
                    # skillgrp.dat); the SERVER value is what actually gets
                    # charged / enforced. Collapsing them to one number would
                    # be inventing an answer to a question the data disputes.
                    n[key + "Sv"] = sv
            # `cast`, `cool` and `reuse` are BASE values. The number a player
            # actually experiences is scaled by attack speed --
            # Formulas.calcAtkSpd: hitTime * 333 / (m)AtkSpd (aCis
            # skills/Formulas.java:771-776), applied in CreatureCast:108-110.
            # Confirmed live: Power Strike base 1080 arrived as 864 with
            # pAtkSpd 416 (1080 * 333 / 416 = 864.4), and its 13000 reuse
            # arrived as 10406. The client must therefore take the cast bar
            # from the MagicSkillUse packet, never from this table.
            for key in ("reuse", "cool", "eff", "radius", "dur", "mpInit",
                        "power"):
                v = s[key]
                if v is not None:
                    n[key] = v
            if s["itemId"] is not None:
                n["item"] = [s["itemId"], s["itemCount"]]
            # Keep zeros. "costs 0 MP" and "has no MP column" are different
            # facts, and dropping the 0 left records carrying an mpSv with no
            # mp to compare it against (426 Battle Force: client 0, server 12).
            entry["n"] = {k: v for k, v in n.items() if v is not None}
            if s["cond"]:
                entry["cn"] = s["cond"]
            if kind == "debuff" and st not in KIND_HOSTILE_SECTIONS:
                # aCis calls it offensive but puts it in no labelled combat
                # section: the kind is a fallback, not a decode.
                entry["kw"] = 1
                weak.append((sid, st))
            if kind == "other":
                unclassified.append((sid, st))
            kinds[kind] += 1
            targets[tgt] += 1
        else:
            # in the client's skillgrp but not in the server's datapack: the
            # client will never receive it in a SkillList, so it has no kind
            entry["k"] = None
            entry["t"] = None
            kinds["<client-only>"] += 1
        entry["nm"] = names.get(sid)
        skills[str(sid)] = entry

    tt = {}
    for name, d in TARGET_TYPES.items():
        tt[name] = {
            "scope": d["scope"],
            "needsTarget": d["needsTarget"],
            "aoe": name in AOE_TARGETS,
            "corpse": name in CORPSE_TARGETS,
            "handled": name in HANDLED_TARGETS,
            "allows": d["allows"],
            "refusals": [{"msg": m, "when": w} for m, w in d["refusals"]],
        }

    used_msgs = set()
    for d in TARGET_TYPES.values():
        used_msgs.update(m for m, _ in d["refusals"])
    used_msgs.update({MSG_NOT_ENOUGH_HP, MSG_NOT_ENOUGH_MP,
                      MSG_PREPARED_FOR_REUSE, MSG_INVALID_TARGET,
                      MSG_S1_CANNOT_BE_USED, MSG_COND_DEFAULT,
                      MSG_CANT_SEE_TARGET})
    for e in skills.values():
        used_msgs.update(e.get("cn", []))

    doc = {
        "source": {
            "kind+target": "aCis data/xml/skills + enums/skills/SkillType.java"
                           " + enums/skills/SkillTargetType.java",
            "targetRules": "aCis handler/targethandlers/*.java "
                           "(getTargetList + meetCastConditions)",
            "operate/is_magic": "skillgrp.dat, read the way NWindow.dll "
                                "0x101b5880 reads it (UIDATA_SKILL::"
                                "GetOperateType) -- SysString 311/312/313/1500",
            "messages": "systemmsg-e.dat via assets/gamedata/systemmsg.json",
        },
        "operateDisplay": {str(v): sysstring.get(v)
                           for v in OPERATE_SYSSTRING.values()},
        "kinds": {k: r for k, r in KIND_RULES},
        "targetTypes": tt,
        "msgs": {str(m): (sysmsg.get(str(m)) or {}).get("text")
                 for m in sorted(used_msgs)},
        "skills": skills,
        # Fields present in the data whose MEANING is not decoded. Shipped so
        # the gap is visible to anything reading this file, rather than being
        # a silence. Each entry says what was measured and what is missing.
        "undecoded": UNDECODED,
    }
    stats = dict(kinds=kinds, targets=targets, disagreements=dis,
                 dis_detail=dis_detail, unclassified=unclassified, weak=weak,
                 server=server, client=client)
    return doc, stats


def selfcheck(doc, stats):
    """Assertions that must FAIL on a tree where the decode is wrong.
    Every one of them measures something first."""
    fails = []
    ok = []

    def want(cond, msg):
        (ok if cond else fails).append(msg)

    sk = doc["skills"]
    want(len(sk) >= 2694, f"skill table has {len(sk)} ids (>=2694)")

    # --- the transcribed java switches still match the source -------------
    src = os.path.join(SRC_JAVA, "skills/L2Skill.java")
    off = parse_java_switch(src, "public final boolean isSkillTypeOffensive")
    dmg = parse_java_switch(src, "public boolean isDamage")
    want(off == OFFENSIVE_TYPES,
         f"isSkillTypeOffensive() transcription matches source ({len(off or [])} cases)")
    want(dmg == DAMAGE_TYPES,
         f"isDamage() transcription matches source ({len(dmg or [])} cases)")
    st_java = os.path.join(SRC_JAVA, "enums/skills/SkillType.java")
    heal = parse_java_section(st_java, "// hp, mp, cp", "GIVE_SP")
    want(heal == KIND_HEAL,
         f"SkillType '// hp, mp, cp' section matches KIND_HEAL ({len(heal)})")
    misc = parse_java_section(st_java, "// MISC", "// Creation")
    want(misc == KIND_MISC,
         f"SkillType '// MISC' section matches KIND_MISC ({len(misc)})")
    fish = parse_java_section(st_java, "// Fishing", "// MISC")
    want(fish == KIND_FISHING,
         f"SkillType '// Fishing' section matches KIND_FISHING ({len(fish)})")
    crea = parse_java_section(st_java, "// Creation", "// Summons")
    want(crea == KIND_CREATION,
         f"SkillType '// Creation' section matches KIND_CREATION ({len(crea)})")
    tt_java = os.path.join(SRC_JAVA, "enums/skills/SkillTargetType.java")
    enum_vals = {ln.strip().rstrip(",")
                 for ln in open(tt_java).read().splitlines()
                 if ln.strip().rstrip(",").isupper() and ln.startswith("\t")}
    want(enum_vals == set(TARGET_TYPES),
         f"SkillTargetType enum fully covered ({len(enum_vals)} values)")
    hdir = os.path.join(SRC_JAVA, "handler/targethandlers")
    on_disk = {f[6:-5] for f in os.listdir(hdir) if f.startswith("Target")}
    want(len(on_disk) == len(HANDLED_TARGETS),
         f"{len(on_disk)} handler classes on disk == {len(HANDLED_TARGETS)} "
         "marked handled")

    # --- the NWindow decode reproduces on real rows -----------------------
    # 3 Power Strike: is_magic 0, operate_type 0 -> 'Active Skill'
    want(sk["3"]["d"] == 311, "skill 3 tooltip line is SysString 311 Active Skill")
    # 264 Song of Earth: is_magic 3 -> 'Song/Dance'
    want(sk["264"]["d"] == 1500, "skill 264 tooltip line is SysString 1500 Song/Dance")
    # 1177 Wind Strike: is_magic 1 -> 'Magic'
    want(sk["1177"]["d"] == 313, "skill 1177 tooltip line is SysString 313 Magic")
    passives = [i for i, e in sk.items() if e.get("d") == 312]
    want(len(passives) > 100, f"{len(passives)} ids print 'Passive Skill'")
    for i in passives[:200]:
        if sk[i].get("sv") not in (None, "PASSIVE"):
            fails.append(f"id {i} prints Passive Skill but aCis says "
                         f"{sk[i]['sv']}")
            break
    else:
        ok.append("every id printing 'Passive Skill' is aCis PASSIVE (sampled)")

    # --- one skill of every kind, and every target scope, is present ------
    kinds = collections.Counter(e["k"] for e in sk.values() if e.get("k"))
    for k, _ in KIND_RULES:
        want(kinds.get(k, 0) > 0, f"kind {k}: {kinds.get(k,0)} skills")
    tcount = collections.Counter(e["t"] for e in sk.values() if e.get("t"))
    want(len(tcount) >= 27, f"{len(tcount)} distinct target types in use")

    # --- messages resolved from the client's own table --------------------
    want(doc["msgs"]["109"] == "Invalid target.", "msg 109 text decoded")
    want(doc["msgs"]["51"] == "You cannot use this on yourself.",
         "msg 51 text decoded")
    want(all(v for v in doc["msgs"].values()),
         f"all {len(doc['msgs'])} refusal messages resolve to real text")
    want(doc["operateDisplay"]["313"] == "Magic",
         "SysString 313 resolves to 'Magic'")
    want(len(doc["undecoded"]) >= 8
         and all(u.get("measured") and u.get("missing") for u in doc["undecoded"]),
         f"{len(doc['undecoded'])} undecoded fields are recorded, each with "
         "what WAS measured and what is missing")

    return ok, fails


def report(doc, stats):
    print("kinds")
    for k, n in stats["kinds"].most_common():
        print(f"  {k:<14} {n}")
    print("targets")
    for k, n in stats["targets"].most_common():
        print(f"  {k:<18} {n}")
    print("client-vs-server disagreements (same field, both present)")
    for k, n in stats["disagreements"].most_common():
        print(f"  {k:<8} {n}")
    unh = [i for i, e in doc["skills"].items()
           if e.get("t") and not doc["targetTypes"][e["t"]]["handled"]]
    print(f"uncastable (target type has no handler class): {len(unh)}")
    print(f"kind-weak (offensive but in no labelled combat section): "
          f"{len(stats['weak'])}")
    print("  ", collections.Counter(t for _, t in stats["weak"]).most_common())
    print(f"still 'other' (no kind rule fires): {len(stats['unclassified'])}")
    print(f"undecoded fields recorded in the output: {len(UNDECODED)}")
    for u in UNDECODED:
        print(f"  - {u['field']}")
    c = collections.Counter(t for _, t in stats["unclassified"])
    print("  ", c.most_common(15))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(SRC_SKILLS):
        sys.exit(f"missing {SRC_SKILLS} — is the datapack built?")

    doc, stats = build()
    ok, fails = selfcheck(doc, stats)
    for m in ok:
        print(f"  ok   {m}")
    for m in fails:
        print(f"  FAIL {m}")
    print(f"assertions {len(ok)} pass / {len(fails)} fail")
    if args.report:
        report(doc, stats)

    if args.check:
        good = not fails and len(ok) >= 20
        print("CHECK", "PASS" if good else "FAIL")
        return 0 if good else 1

    if fails:
        sys.exit("refusing to write: self-check failed")
    with open(OUT, "w") as f:
        json.dump(doc, f, separators=(",", ":"), sort_keys=True)
    print(f"wrote {os.path.relpath(OUT, REPO)} "
          f"({os.path.getsize(OUT)/1024:.0f} KB, {len(doc['skills'])} skills)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
