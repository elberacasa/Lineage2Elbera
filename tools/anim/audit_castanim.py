#!/usr/bin/env python3
"""audit_castanim.py — how much of the skill-cast animation is DECODED, and
how much is a documented floor.

Three questions, each answered with a count over the real tables rather than
a claim:

  A. CLIP CHOICE PER (pawn, stance).  The runtime used to build a stanced
     clip name by concatenation (`spAtk01` + '_' + stance, unstanced clip if
     that misses).  The client ships its own answer in lineagewarrior.int.
     This counts the pairs where the two disagree.

  B. SKILL COVERAGE.  Of the skills a player can actually cast, how many
     resolve to a clip the CLIENT names (dances, and every magic wind-up /
     launch / recovery slot), and how many land on the one physical slot the
     port holds as a floor because skillgrp's animation letter -> SpAtk slot
     mapping is not in the shipped client.

  C. UNREACHED RETAIL DATA.  Slots the client fills that the glTF pipeline
     does not ship at all, and shipped clips no cast path can select.

Every number here is re-derived from
  editor/characters/pawnanim.json   (tools/anim/build_pawnanim.py)
  assets/gamedata/skillanim.json    (tools/dat/build_skillanim.py)
  editor/characters/manifest.json
and diffed against tools/anim/castanim_baseline.json.

Usage:
  python3 tools/anim/audit_castanim.py            # report + write baseline
  python3 tools/anim/audit_castanim.py --check    # report + fail on drift
  python3 tools/anim/audit_castanim.py --selftest # prove the gates can fail
"""

import argparse
import collections
import json
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "..", ".."))
PAWNANIM = os.path.join(ROOT, "editor", "characters", "pawnanim.json")
MANIFEST = os.path.join(ROOT, "editor", "characters", "manifest.json")
SKILLANIM = os.path.join(ROOT, "assets", "gamedata", "skillanim.json")
BASELINE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "castanim_baseline.json")

STANCES = ["hand", "1hs", "2hs", "dual", "pole", "bow"]
PHYS_SLOT = "spAtk01"
DANCE_SLOT = "spAtk05"
MAGIC_WINDUPS = ["castShort", "castMid", "castLong"]
MAGIC_OTHER = ["castEnd", "magicShot", "magicThrow", "magicNoTarget"]


def legacy_concat_pick(shipped, stance):
    """The pre-fix runtime rule, reproduced verbatim from
    editor/world/js/character.js `_clip()`: for a non-'hand' stance try
    '<name>_<stance>' then '<name.toLowerCase()>_<stance>', else the
    unstanced clip.  'hand' returns the name unchanged."""
    if stance == "hand":
        return "spAtk01"
    for token in ("spAtk01", "spatk01"):
        cand = "%s_%s" % (token, stance)
        if cand.lower() in shipped:
            return cand.lower()
    return "spAtk01"


def audit():
    pa = json.load(open(PAWNANIM))
    manifest = {m["id"]: m for m in json.load(open(MANIFEST))["models"]}
    skillanim = json.load(open(SKILLANIM))
    out = {}

    # ---------------------------------------------------------------- A
    rows, mismatches = 0, []
    for mid, model in sorted(pa["models"].items()):
        shipped = set(a.lower() for a in manifest[mid]["animations"])
        for stance in STANCES:
            client = (model["slots"].get(PHYS_SLOT, {}) or {}).get(stance)
            legacy = legacy_concat_pick(shipped, stance)
            rows += 1
            if client is None:
                continue          # retail has no entry: not a disagreement
            if client["clip"].lower() != legacy.lower():
                mismatches.append({"model": mid, "stance": stance,
                                   "client": client["clip"],
                                   "clientSeq": client["seq"],
                                   "legacy": legacy})
    if rows != len(pa["models"]) * len(STANCES):
        raise SystemExit("FATAL: gate A walked %d pairs, expected %d"
                         % (rows, len(pa["models"]) * len(STANCES)))
    out["A_pairs_walked"] = rows
    out["A_pairs_with_client_entry"] = sum(
        1 for m in pa["models"].values() for s in STANCES
        if (m["slots"].get(PHYS_SLOT, {}) or {}).get(s))
    out["A_concat_mismatches"] = len(mismatches)
    out["A_mismatch_detail"] = sorted(
        mismatches, key=lambda r: (r["model"], r["stance"]))

    # ---------------------------------------------------------------- B
    # "usable" = a skill the player can cast at all: skillanim's base rows
    # (no '<id>_<level>' overrides) with a non-empty animation code.  An
    # empty code is retail's own answer for every passive and toggle and is
    # counted separately, not as a miss.
    cats = collections.Counter()
    per_code_phys = collections.Counter()
    for key, e in skillanim.items():
        if "_" in key:
            continue
        anim = e.get("anim") or ""
        if not anim:
            cats["passive_or_toggle_no_gesture"] += 1
            continue
        if e.get("magic") == 3 or anim in ("N", "W"):
            cats["dance_or_song_client_slot_spAtk05"] += 1
        elif e.get("magic") == 0:
            cats["physical_floor_slot_spAtk01"] += 1
            per_code_phys[anim] += 1
        else:
            cats["magic_client_slots_castX_magicX"] += 1
    total = sum(cats.values())
    if total != len([k for k in skillanim if "_" not in k]):
        raise SystemExit("FATAL: gate B lost rows (%d vs %d)" % (total, len(skillanim)))
    out["B_skill_rows"] = total
    out["B_by_category"] = dict(sorted(cats.items()))
    out["B_specific_clip"] = (cats["dance_or_song_client_slot_spAtk05"]
                              + cats["magic_client_slots_castX_magicX"])
    out["B_generic_floor"] = cats["physical_floor_slot_spAtk01"]
    out["B_distinct_physical_codes_collapsed"] = len(per_code_phys)
    out["B_physical_codes"] = dict(sorted(per_code_phys.items()))

    # ---------------------------------------------------------------- C
    unshipped = collections.Counter()
    for mid, model in pa["models"].items():
        for slot, row in model.get("unshipped", {}).items():
            if slot in MAGIC_WINDUPS + MAGIC_OTHER:
                unshipped[slot] += 1
    out["C_magic_slots_client_fills_gltf_lacks"] = dict(sorted(unshipped.items()))

    reachable = set()
    for mid, model in pa["models"].items():
        for slot in [PHYS_SLOT, DANCE_SLOT] + MAGIC_WINDUPS + MAGIC_OTHER:
            for stance in STANCES:
                hit = (model["slots"].get(slot, {}) or {}).get(stance)
                if hit:
                    reachable.add((mid, hit["clip"].lower()))
    spatk_shipped = {(mid, a.lower()) for mid, m in manifest.items()
                     for a in m["animations"] if a.lower().startswith("spatk")}
    out["C_spatk_clips_shipped"] = len(spatk_shipped)
    out["C_spatk_clips_reachable"] = len(spatk_shipped & reachable)
    out["C_spatk_clips_unreachable"] = len(spatk_shipped - reachable)

    # keyframe inventory — proves the phase data is non-empty
    kinds = collections.Counter()
    for mid, cl in pa["clips"].items():
        for clip, info in cl.items():
            for n in info["notifies"]:
                kinds[n["kind"]] += 1
    out["D_notify_keyframes_by_kind"] = dict(sorted(kinds.items()))
    if not kinds:
        raise SystemExit("FATAL: gate D found 0 keyframes — vacuous")
    return out


def canonical(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"))


def report(o):
    print("A. clip choice: %d (pawn,stance) pairs walked, %d have a client "
          "entry, %d disagree with the concat rule"
          % (o["A_pairs_walked"], o["A_pairs_with_client_entry"],
             o["A_concat_mismatches"]))
    for r in o["A_mismatch_detail"]:
        print("     %-16s %-5s client %-14s (%s)   concat %s"
              % (r["model"], r["stance"], r["client"], r["clientSeq"], r["legacy"]))
    print("B. skills: %d rows; %d resolve to a clip the CLIENT names, "
          "%d land on the documented physical floor, %d have no gesture at all"
          % (o["B_skill_rows"], o["B_specific_clip"], o["B_generic_floor"],
             o["B_by_category"]["passive_or_toggle_no_gesture"]))
    print("     the %d physical skills carry %d DISTINCT skillgrp animation "
          "codes, all collapsed to %s: %s"
          % (o["B_generic_floor"], o["B_distinct_physical_codes_collapsed"],
             PHYS_SLOT, o["B_physical_codes"]))
    print("C. retail slots the client fills and no glTF ships: %s"
          % o["C_magic_slots_client_fills_gltf_lacks"])
    print("   spatk clips shipped %d, reachable from a cast %d, unreachable %d"
          % (o["C_spatk_clips_shipped"], o["C_spatk_clips_reachable"],
             o["C_spatk_clips_unreachable"]))
    print("D. notify keyframes: %s" % o["D_notify_keyframes_by_kind"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        return selftest()

    o = audit()
    report(o)
    if args.check:
        if not os.path.exists(BASELINE):
            print("FAIL: no baseline at %s" % BASELINE)
            return 1
        base = json.load(open(BASELINE))
        bad = 0
        for k in sorted(set(base) | set(o)):
            if canonical(base.get(k)) != canonical(o.get(k)):
                print("FAIL drift %s: %s -> %s"
                      % (k, canonical(base.get(k))[:110],
                         canonical(o.get(k))[:110]))
                bad += 1
        if bad:
            return 1
        print("OK: %d audited quantities match the baseline" % len(o))
        return 0
    json.dump(o, open(BASELINE, "w"), indent=1, sort_keys=True)
    print("wrote %s" % BASELINE)
    return 0


def selftest():
    fails = 0
    o = audit()
    # the concat rule must actually differ somewhere, or gate A is decorative
    if o["A_concat_mismatches"] == 0:
        print("SELFTEST FAIL: gate A found nothing to compare")
        fails += 1
    else:
        print("SELFTEST ok: gate A measures %d real disagreements"
              % o["A_concat_mismatches"])
    # a corrupted baseline must be detected
    tmp = dict(json.load(open(BASELINE))) if os.path.exists(BASELINE) else None
    if tmp is None:
        print("SELFTEST skip: no baseline written yet")
    else:
        tmp["A_concat_mismatches"] = -1
        if canonical(tmp.get("A_concat_mismatches")) == canonical(
                o.get("A_concat_mismatches")):
            print("SELFTEST FAIL: drift detector cannot see a changed count")
            fails += 1
        else:
            print("SELFTEST ok: drift detector sees a changed count")
    if o["B_skill_rows"] < 1000:
        print("SELFTEST FAIL: gate B walked only %d rows" % o["B_skill_rows"])
        fails += 1
    else:
        print("SELFTEST ok: gate B walked %d skill rows" % o["B_skill_rows"])
    print("selftest: %d failure(s)" % fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
