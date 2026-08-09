#!/usr/bin/env python3
"""build_pawnanim.py — WHICH clip a player skill cast plays, and WHEN its
phases fire.  Both answers come out of the shipped client; neither is a rule
invented here.

---------------------------------------------------------------------------
1. THE CLIENT SHIPS ITS OWN PAWN ANIMATION TABLE
---------------------------------------------------------------------------
`Engine.Pawn` declares the pawn animation slots as `var localized name`
arrays — the same declaration shape as `PcSocialAnimName`, which
tools/anim/creature_anim_table.py already decrypts for the twelve social
emotes.  The values live in

    assets/interlude/system/lineagewarrior.int      (Lineage2Ver111)

one section per race/sex prefix (14 of them: MFighter … FDwarf), and every
slot is indexed by the WEAPON STANCE:

    [MFighter]
    CastShortAnimName[1]=CastShort_MFighter
    MagicThrowAnimName[1]=MagicThrow_MFighter
    SpAtk01AnimName[1]=SpAtk01_1HS_MFighter
    SpAtk25AnimName[3]=SpAtk03_1HS_MFighter        <-- slot 25 is clip 03
    SpAtk15AnimName[3]=shieldatk_1HS_MFighter      <-- and slot 15 a shield bash
    SpAtk05AnimName[0..5]=Social_dance_MFighter    <-- the dance IS a SpAtk slot

The index domain is the client's own handness enumeration, already recovered
into editor/characters/stances.json from NWindow.dll's pawn-viewer literals:

    0(HAND) 1(1HS) 2(2HS) 3(DUAL) 4(POLE) 5(BOW) 7(DUALFIST)

and lineagewarrior.int agrees with it independently — index 4 carries every
pawn's `*_Pole_*` clips and index 5 every `*_Bow_*` clip, checked for all 14
prefixes (see check_stance_order()).  NOTE for readers of
tools/src/char_pipeline/anim_stances.py and tools/audio/build_stepnotify.py:
both hold the six tokens in the order `Hand 1HS 2HS Dual Bow Pole` under a
comment calling that "the client's handness order".  It is not — Pole is 4
and Bow is 5.  Neither file indexes by position, so nothing is broken there,
but the comment is wrong and this file does not copy it.

Two consequences, both MEASURED here rather than reasoned from names:

  * the seven magic slots (CastShort/CastMid/CastLong/CastEnd/MagicShot/
    MagicThrow/MagicNoTarget) hold the SAME clip at every one of the six
    stances, for every pawn — 98/98 (pawn, slot) pairs.  A magic cast does
    not vary with the equipped weapon.
  * the physical SpAtk slots DO vary by stance, and slot number is NOT clip
    number.  Building the clip name by pasting "spatk%02d_%s" is wrong for a
    measurable share of the table (audit_castanim.py counts it).

---------------------------------------------------------------------------
2. THE CLIPS CARRY THE PHASE KEYFRAMES
---------------------------------------------------------------------------
Every sequence in `animations/<Pkg>.ukx` carries a `TArray<FMeshAnimNotify>`;
the notify objects are exports of the same package, so their CLASS is the
phase name.  Layout and the umodel-oracle location strategy are
tools/audio/build_stepnotify.py's (this file imports it rather than
re-deriving it).  The classes that appear on cast/attack sequences:

    AnimNotify_AttackPreShot   wind-up committed  (bow draw, cast pre-roll)
    AnimNotify_AttackShot      THE HIT / LAUNCH INSTANT
    AnimNotify_AttackItem      weapon-trail / item effect
    AnimNotify_AttackVoice     the attack grunt
    AnimNotify_Channeling      channel loop point (CastLong only)
    AnimNotify_Sound           a literal sound ref

Those five phase names are the same five the retail effect table
`Skill.usk` uses for its per-skill action lists — `CastingActions`,
`ChannelingActions`, `PreshotActions`, `ShotActions`, `ExplosionActions`
(docs/skillfx-data.md).  Two independent files in the client agree on the
phase vocabulary, which is why the phases are treated as real here.

`t` is retail's own normalised notify time.  `u` is the same instant as a
fraction of the SHIPPED glTF clip, u = t*NumFrames/(NumFrames-1), for the
reason build_stepnotify.py derives and asserts: the exporter writes key i at
i/Rate, so the glTF clip lasts (NumFrames-1)/Rate while retail's sequence
lasts NumFrames/Rate.

---------------------------------------------------------------------------
3. WHAT IS STILL NOT DECODED (stated, not guessed)
---------------------------------------------------------------------------
  * `skillgrp.dat`'s `animation` code ('S', 't', 'V', 'Mix01' …) -> WHICH
    SpAtk slot.  This file supplies slot -> clip; nothing in the client
    supplies code -> slot.  Searched and came up empty:
      - engine.dll is Themida-packed.  Its export names survive and prove
        the slot count (`?GetSpAtk01AnimName@APawn@@…` through SpAtk28, plus
        GetCastShort/Mid/Long/End, GetMagicShot/Throw/NoTarget, GetShieldAtk
        — 28 + 8, exactly the slots lineagewarrior.int fills), but no data
        string of the main section is readable: "SpAtk01" as a plain string
        does not occur anywhere outside those mangled names.
      - no .u package name table contains any SpAtk*/Cast*/Magic* name
        (21 packages checked, 0 hits), so the construction is native.
      - MobSkillAnimgrp.dat (5463 rows) is NOT a Rosetta stone: it is
        authored per (npc, skill), and grouping its literal anim names by
        the caster skill's skillgrp letter gives no consistent mapping
        (letter 'D' -> spatk01 105x / social01 44x / spatk02 20x / atk01 2x).
    So the runtime keeps ONE deterministic slot for physical skills and
    says so, rather than spreading a guess over 500 skills.
  * WHICH of CastShort/CastMid/CastLong a given cast duration selects.  The
    three clips' true lengths are measured here (0.833 s / ~1.833 s /
    3.833 s at 30 fps); the threshold rule is in the packed native code.

---------------------------------------------------------------------------
WHAT THIS WRITES
---------------------------------------------------------------------------
    editor/characters/pawnanim.json      (served at /characters/pawnanim.json)

    {"source": {...},
     "stanceIndex": ["hand","1hs","2hs","dual","pole","bow"],
     "magicSlots": [...], "physicalSlots": [...],
     "models": {"<id>": {
        "prefix": "MFighter",
        "slots": {"<slot>": {"<stance>": {"seq","clip"}}},
        "unshipped": {"<slot>": {"<stance>": "<retail seq with no glTF clip>"}},
        "rates": {"atk01": 0.8333, ...}}},
     "clips": {"<id>": {"<glTF clip>": {
        "seq","frames","rate","dur","notifies":[{"kind","t","u","sec","sound"}]}}}}

Usage:
  python3 tools/anim/build_pawnanim.py            # write it
  python3 tools/anim/build_pawnanim.py --check    # re-derive, diff, no write
  python3 tools/anim/build_pawnanim.py --selftest # prove the gates can fail
"""

import argparse
import collections
import json
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tools", "world"))
sys.path.insert(0, os.path.join(ROOT, "tools", "audio"))

from l2lib import load_package, L2Error                       # noqa: E402
from l2lib.ue2package import decrypt_file_bytes               # noqa: E402
from build_stepnotify import psa_seqs, read_sequences, notify_props, PSA  # noqa: E402

CLIENT = os.path.join(ROOT, "assets", "interlude")
WARRIOR_INT = os.path.join(CLIENT, "system", "lineagewarrior.int")
ANIMS = os.path.join(CLIENT, "animations")
CHARACTERS = os.path.join(ROOT, "editor", "characters")
MANIFEST = os.path.join(CHARACTERS, "manifest.json")
OUT = os.path.join(CHARACTERS, "pawnanim.json")

# (client model id, .ukx package, lineagewarrior.int section / sequence
# prefix).  Same 14 rows as build_characters.COMBOS and
# build_stepnotify.PAWNS; asserted against the shipped manifest in build().
PAWNS = [
    ("human_fighter_m", "Fighter", "MFighter"),
    ("human_fighter_f", "Fighter", "FFighter"),
    ("human_mystic_m",  "Magic",   "MMagic"),
    ("human_mystic_f",  "Magic",   "FMagic"),
    ("elf_m",           "Elf",     "MElf"),
    ("elf_f",           "Elf",     "FElf"),
    ("darkelf_m",       "DarkElf", "MDarkElf"),
    ("darkelf_f",       "DarkElf", "FDarkElf"),
    ("orc_fighter_m",   "Orc",     "MOrc"),
    ("orc_fighter_f",   "Orc",     "FOrc"),
    ("orc_mystic_m",    "Shaman",  "MShaman"),
    ("orc_mystic_f",    "Shaman",  "FShaman"),
    ("dwarf_m",         "Dwarf",   "MDwarf"),
    ("dwarf_f",         "Dwarf",   "FDwarf"),
]

# The client's handness enumeration (NWindow.dll pawn-viewer literals, already
# in editor/characters/stances.json), CONFIRMED against lineagewarrior.int by
# check_stance_order().  6 is absent from the client's own list; 7 (DUALFIST)
# repeats the Hand clips and has no suffix of its own.
STANCE_INDEX = ["hand", "1hs", "2hs", "dual", "pole", "bow"]

# The seven slots that never vary with the stance (asserted, not assumed).
MAGIC_SLOTS = ["castShort", "castMid", "castLong", "castEnd",
               "magicShot", "magicThrow", "magicNoTarget"]

# lineagewarrior.int key -> the name used in the emitted table.
KEY_SLOT = {
    "CastShortAnimName": "castShort", "CastMidAnimName": "castMid",
    "CastLongAnimName": "castLong", "CastEndAnimName": "castEnd",
    "MagicShotAnimName": "magicShot", "MagicThrowAnimName": "magicThrow",
    "MagicNoTargetAnimName": "magicNoTarget",
    "ShieldAtkAnimName": "shieldAtk",
    "Atk01AnimName": "atk01", "Atk02AnimName": "atk02", "Atk03AnimName": "atk03",
    "AtkWaitAnimName": "atkWait",
}
for _i in range(1, 29):
    KEY_SLOT["SpAtk%02dAnimName" % _i] = "spAtk%02d" % _i

RATE_KEYS = {"Atk01AnimRate": "atk01", "Atk02AnimRate": "atk02",
             "Atk03AnimRate": "atk03", "sitanimrate": "sit",
             "standanimrate": "stand"}

_SECTION_RE = re.compile(r"^\[(\w+)\]$")
_ENTRY_RE = re.compile(r"^(\w+)\[(\d+)\]=(.*)$")


# --------------------------------------------------------------------------
# lineagewarrior.int
# --------------------------------------------------------------------------
def read_warrior_int(path=WARRIOR_INT):
    """-> {prefix: {(key, index): value}}.  Lineage2Ver111, plain ASCII once
    decrypted (NOT UTF-16, unlike the .dat tables)."""
    with open(path, "rb") as fh:
        plain, _proto = decrypt_file_bytes(fh.read(), os.path.basename(path))
    text = plain.decode("latin1")
    out, cur = collections.defaultdict(dict), None
    for line in text.splitlines():
        line = line.strip()
        m = _SECTION_RE.match(line)
        if m:
            cur = m.group(1)
            continue
        m = _ENTRY_RE.match(line)
        if m and cur:
            out[cur][(m.group(1), int(m.group(2)))] = m.group(3).strip()
    if not out:
        raise L2Error("%s: parsed 0 sections" % path)
    return out


def check_stance_order(tbl, stats):
    """The stance index is the client's handness enum, not a name guess.
    Falsifiable: every WaitAnimName[i] must end in the suffix STANCE_INDEX[i]
    names.  Fails loudly if the order is wrong."""
    seen = 0
    for _mid, _pkg, prefix in PAWNS:
        for i, token in enumerate(STANCE_INDEX):
            v = tbl[prefix].get(("WaitAnimName", i))
            if v is None:
                raise L2Error("%s WaitAnimName[%d] missing" % (prefix, i))
            want = "_%s_" % token if token != "hand" else "_hand_"
            if want.lower() not in v.lower():
                raise L2Error("stance order wrong: %s WaitAnimName[%d]=%s "
                              "is not a '%s' clip" % (prefix, i, v, token))
            seen += 1
    if seen != len(PAWNS) * len(STANCE_INDEX):
        raise L2Error("stance-order gate evaluated %d assertions" % seen)
    stats["stance_order_checked"] = seen
    return seen


# --------------------------------------------------------------------------
# retail sequence name -> shipped glTF clip id
# --------------------------------------------------------------------------
# Reproduces tools/src/char_pipeline/build_characters.py exactly:
#   frozen unstanced names come from ANIM_CANDIDATES (first candidate that the
#   package ships wins), stanced ones from anim_stances.stance_clips()
#   ('<action>_<stance>' lowercase, Wait -> idle), social ones from
#   social_slot().  Rather than trust that reproduction, build() ASSERTS the
#   derived clip-id set equals the shipped manifest's animation list for all
#   14 models — if the pipeline ever renames a clip this file fails.
ANIM_CANDIDATES = {
    'idle':   ['Wait_Hand_{P}', 'Wait_1HS_{P}', 'SitWait_{P}'],
    'walk':   ['Walk_Hand_{P}', 'Walk_1HS_{P}'],
    'run':    ['Run_Hand_{P}', 'Run_1HS_{P}'],
    'sit':    ['SitWait_{P}'],
    'dance':  ['Social_dance_{P}'],
    'attack': ['Atk01_Hand_{P}', 'Atk01_1HS_{P}'],
    'castShort':  ['CastShort_{P}'],
    'castMid':    ['CastMid_{P}'],
    'castLong':   ['CastLong_{P}'],
    'magicThrow': ['MagicThrow_{P}'],
    'spAtk01': ['SpAtk01_1HS_{P}', 'SpAtk02_1HS_{P}', 'SpAtk06_Hand_{P}'],
    'spAtk02': ['SpAtk02_1HS_{P}', 'SpAtk02_Bow_{P}', 'SpAtk01_2HS_{P}'],
    'die':    ['Death_{P}'],
    'damage': ['Damagefly_{P}', 'Damegefly_{P}'],
}
STANCE_ACTION_RE = re.compile(
    r'^(Wait|Walk|Run|AtkWait|ShieldAtk|Atk\d+|SpAtk\d+)_(Hand|1HS|2HS|Dual|Bow|Pole)$',
    re.I)
CLIP_ACTION = {'wait': 'idle', 'walk': 'walk', 'run': 'run',
               'atkwait': 'atkwait', 'shieldatk': 'shieldatk'}


def clip_index(seq_names, prefix):
    """-> {retail sequence name (lower): [glTF clip ids]}.

    One-to-MANY on purpose.  build_characters.py emits the same retail
    sequence under two clip ids when a frozen ANIM_CANDIDATES name and a
    stanced name both select it — `Atk01_Hand_MFighter` is shipped as both
    `attack` and `atk01_hand`, `SpAtk01_1HS_MFighter` as both `spAtk01` and
    `spatk01_1hs`.  Collapsing that to one id was the first version of this
    function and it dropped 3 clips per pawn; `pick()` chooses per stance."""
    have = {n.lower(): n for n in seq_names}
    idx = {}

    def claim(seq, clip):
        row = idx.setdefault(seq.lower(), [])
        if clip not in row:
            row.append(clip)

    for clip, cands in ANIM_CANDIDATES.items():
        for c in cands:
            hit = have.get(c.format(P=prefix).lower())
            if hit:
                claim(hit, clip)
                break
    suffix = "_" + prefix.lower()
    for low, orig in have.items():
        if not low.endswith(suffix):
            continue
        base = orig[:-len(suffix)]
        m = STANCE_ACTION_RE.match(base)
        if m:
            action, stance = m.group(1).lower(), m.group(2).lower()
            claim(orig, "%s_%s" % (CLIP_ACTION.get(action, action), stance))
        elif base.lower().startswith("social_"):
            claim(orig, "social_" + base[len("Social_"):].lower())
    return idx


def pick(cidx, seq, stance):
    """The glTF clip id to play for a retail sequence at a given stance:
    the stanced id when the model ships one, else the unstanced id.  Both
    name the SAME retail sequence, so this only decides which of the two
    duplicate glTF tracks is used — never which motion plays."""
    row = cidx.get(seq.lower())
    if not row:
        return None
    for c in row:
        if c.lower().endswith("_" + stance):
            return c
    return row[0]


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------
def build(stats):
    tbl = read_warrior_int()
    check_stance_order(tbl, stats)

    manifest = {m["id"]: m for m in json.load(open(MANIFEST))["models"]}
    if sorted(manifest) != sorted(p[0] for p in PAWNS):
        raise L2Error("PAWNS and the shipped manifest disagree: %s vs %s"
                      % (sorted(p[0] for p in PAWNS), sorted(manifest)))

    models, clips = {}, {}
    invariant_ok = invariant_tot = 0
    unshipped_magic = []
    notify_rows = 0
    for model_id, package, prefix in PAWNS:
        pkg, _ = load_package(os.path.join(ANIMS, "%s.ukx" % package))
        exp = [e for e in pkg.exports if pkg.export_name(e) == prefix + "_anim"]
        if not exp:
            raise L2Error("%s: no MeshAnimation %s_anim" % (package, prefix))
        oracle = psa_seqs(os.path.join(PSA, package, "MeshAnimation",
                                       prefix + "_anim.psa"))
        seqs, missing = read_sequences(pkg, exp[0], oracle)
        if missing:
            raise L2Error("%s: %d sequences not located: %s"
                          % (prefix, len(missing), missing[:5]))
        by_seq = {s["name"]: s for s in seqs}
        cidx = clip_index(by_seq, prefix)

        shipped = {a.lower(): a for a in manifest[model_id]["animations"]}
        # The pipeline ships only the twelve PcSocialAnimName emotes, not every
        # Social_* sequence in the package: retail's Social_SpWait01..04 are
        # real sequences with no glTF clip.  Drop derivations the model does
        # not carry — they belong in `unshipped`, which is the honest place
        # for "retail has it, we do not".
        cidx = {seq: [c for c in row if c.lower() in shipped]
                for seq, row in cidx.items()}
        cidx = {seq: row for seq, row in cidx.items() if row}
        # The gate that matters, and it is the strict direction: every cast,
        # attack and stanced clip the manifest DOES ship must be reachable
        # from a retail sequence name here.  A rename in the pipeline breaks
        # this instead of silently emptying the table.
        want = {c for c in shipped
                if c.startswith(("spatk", "atk0", "atkwait", "shieldatk",
                                 "cast", "magicthrow"))}
        got = {c.lower() for row in cidx.values() for c in row}
        if not want <= got:
            raise L2Error("%s: shipped clips no retail sequence maps to: %s"
                          % (model_id, sorted(want - got)[:8]))
        stats["clip_ids_mapped"] = stats.get("clip_ids_mapped", 0) + len(want)

        # ---- slot table
        slots, unshipped = {}, {}
        for (key, si), value in sorted(tbl[prefix].items()):
            slot = KEY_SLOT.get(key)
            if slot is None or si >= len(STANCE_INDEX):
                continue
            stance = STANCE_INDEX[si]
            clip = pick(cidx, value, stance)
            if clip is None:
                unshipped.setdefault(slot, {})[stance] = value
            else:
                slots.setdefault(slot, {})[stance] = {"seq": value, "clip": clip}
        # Stance-invariance is a claim about the CLIENT'S table, so it is
        # measured on the raw lineagewarrior.int values — not on the resolved
        # glTF clips, which would silently pass whenever a slot is unshipped.
        key_of = {v: k for k, v in KEY_SLOT.items()}
        for slot in MAGIC_SLOTS:
            raw = [tbl[prefix].get((key_of[slot], i))
                   for i in range(len(STANCE_INDEX))]
            invariant_tot += 1
            if any(v is None for v in raw):
                raise L2Error("%s %s: missing a stance entry" % (model_id, slot))
            if len({v.lower() for v in raw}) == 1:
                invariant_ok += 1
            else:
                raise L2Error("%s %s varies by stance: %s"
                              % (model_id, slot, sorted(set(raw))))
            if slot not in slots:
                unshipped_magic.append("%s.%s" % (model_id, slot))

        rates = {}
        for (key, si), value in tbl[prefix].items():
            if key in RATE_KEYS and si == 1:
                rates[RATE_KEYS[key]] = float(value)

        models[model_id] = {"prefix": prefix, "slots": slots,
                            "unshipped": unshipped, "rates": rates}

        # ---- clip keyframes (only clips the glTF actually ships)
        cl = {}
        for seq_name, seq in by_seq.items():
            targets = cidx.get(seq_name.lower(), [])
            if not targets:
                continue
            frames, rate = seq["frames"], seq["rate"]
            dur = frames / rate if rate else 0.0
            scale = frames / (frames - 1.0) if frames > 1 else 1.0
            notes = []
            for t, _fn, obj in seq["notifys"]:
                if not obj:
                    continue
                cls, props = notify_props(pkg, obj)
                kind = cls[len("AnimNotify_"):] if cls.startswith("AnimNotify_") \
                    else cls
                row = {"kind": kind, "t": round(t, 6),
                       "u": round(t * scale, 6), "sec": round(t * dur, 6)}
                snd = props.get("Sound", {})
                if snd:
                    row["sound"] = str(snd[sorted(snd)[0]])
                notes.append(row)
                notify_rows += 1
            notes.sort(key=lambda r: r["t"])
            for clip in targets:
                cl[clip] = {"seq": seq_name, "frames": frames, "rate": rate,
                            "dur": round(dur, 6), "notifies": notes}
        clips[model_id] = cl

    stats["magic_stance_invariant"] = "%d/%d" % (invariant_ok, invariant_tot)
    stats["magic_slots_not_shipped"] = unshipped_magic
    stats["notify_rows"] = notify_rows
    if invariant_ok != invariant_tot:
        raise L2Error("magic slots are not stance-invariant: %s"
                      % stats["magic_stance_invariant"])
    if notify_rows == 0:
        raise L2Error("0 notify rows — the gate would be vacuous")

    return {
        "source": {
            "slot_table": "assets/interlude/system/lineagewarrior.int "
                          "(Lineage2Ver111) — Engine.Pawn's localized "
                          "*AnimName[stance] arrays, 14 sections",
            "stance_enum": "editor/characters/stances.json / NWindow.dll "
                           "0 HAND 1 1HS 2 2HS 3 DUAL 4 POLE 5 BOW, "
                           "re-confirmed against lineagewarrior.int",
            "keyframes": "assets/interlude/animations/<Pkg>.ukx "
                         "FMeshAnimSeq.Notifys; layout per "
                         "tools/audio/build_stepnotify.py",
            "slot_count": "engine.dll exports GetSpAtk01..28AnimName + "
                          "GetCastShort/Mid/Long/End + GetMagicShot/Throw/"
                          "NoTarget + GetShieldAtk",
            "undecoded": "skillgrp.animation code -> SpAtk slot number. "
                         "Not present in any readable client file; see the "
                         "module docstring for what was searched.",
        },
        "stanceIndex": STANCE_INDEX,
        "magicSlots": MAGIC_SLOTS,
        "physicalSlots": ["spAtk%02d" % i for i in range(1, 29)],
        "models": models,
        "clips": clips,
    }


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="re-derive and diff against the written file")
    ap.add_argument("--selftest", action="store_true",
                    help="prove the gates fail on corrupted input")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    stats = {}
    out = build(stats)
    print("pawns %d  stance-order assertions %d  magic stance-invariant %s  "
          "notify keyframes %d"
          % (len(out["models"]), stats["stance_order_checked"],
             stats["magic_stance_invariant"], stats["notify_rows"]))

    if args.check:
        if not os.path.exists(OUT):
            print("FAIL: %s does not exist" % OUT)
            return 1
        have = json.load(open(OUT))
        if canonical(have) != canonical(out):
            print("FAIL: %s differs from a fresh derivation" % OUT)
            return 1
        print("OK: %s matches a fresh derivation" % OUT)
        return 0

    with open(OUT, "w") as fh:
        json.dump(out, fh, sort_keys=True, separators=(",", ":"))
    print("wrote %s (%d bytes)" % (OUT, os.path.getsize(OUT)))
    return 0


def selftest():
    """Each gate must FAIL on input that breaks it — a gate that cannot go
    red is not a gate."""
    fails = 0

    # 1. stance order: swap Pole and Bow and the WaitAnimName gate must fire.
    tbl = read_warrior_int()
    global STANCE_INDEX
    good = STANCE_INDEX
    STANCE_INDEX = ["hand", "1hs", "2hs", "dual", "bow", "pole"]
    try:
        check_stance_order(tbl, {})
        print("SELFTEST FAIL: stance-order gate accepted a swapped order")
        fails += 1
    except L2Error as e:
        print("SELFTEST ok: stance order rejected (%s)" % str(e)[:70])
    finally:
        STANCE_INDEX = good

    # 2. the gate must count what it checked, not pass on an empty table.
    try:
        check_stance_order(collections.defaultdict(dict), {})
        print("SELFTEST FAIL: stance-order gate passed on an EMPTY table")
        fails += 1
    except L2Error:
        print("SELFTEST ok: empty table rejected (no vacuous pass)")

    # 3. clip_index must not invent a clip the package does not ship.
    idx = clip_index(["Wait_Hand_MFighter"], "MFighter")
    if "castshort_mfighter" in idx:
        print("SELFTEST FAIL: clip_index invented a cast clip")
        fails += 1
    else:
        print("SELFTEST ok: clip_index claims only shipped sequences")

    print("selftest: %d failure(s)" % fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
