#!/usr/bin/env python3
"""Build assets/gamedata/skillanim.json — the compact per-skill visual
presentation map the web client consumes at cast time.

Joins two decoded tables (both real, in this repo):
  assets/gamedata/skillgrp.json      (skillgrp.dat)  — animation letter code,
                                      is_magic, cast_range, cast_style
  assets/gamedata/skillsoundgrp.json (skillsoundgrp.dat,
                                      tools/dat/parse_skillsoundgrp.py)
                                   — cast/shot/explosion sound refs

skillgrp.json is 11 MB (29812 id×level records) — too heavy for the client
to fetch for a cast-time lookup. This emits one entry per skill id (lowest
level, same convention as build_meta.py's skillmeta.json) plus a per-level
override only where the level's presentation differs:

  {
    "<skillId>": {"anim": "S", "magic": 0, "range": 40, "style": 3,
                  "snd": {"cast": "SkillSound.power_strike_cast",
                          "shot": "SkillSound.power_strike_shot"}},
    "<skillId>_<level>": {...}   // only when different from the base entry
  }

`range` is -1 where the dat holds 0xFFFFFFFF (self/no-range skills).
`snd` is omitted for skills without a skillsoundgrp row; empty sound slots
are omitted inside `snd`.

Usage:
  /usr/bin/python3 tools/dat/build_skillanim.py           # write JSON
  /usr/bin/python3 tools/dat/build_skillanim.py --check   # verify only
"""

import argparse
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GAMEDATA = os.path.join(ROOT, "assets", "gamedata")
OUT_PATH = os.path.join(GAMEDATA, "skillanim.json")


def load(name):
    with open(os.path.join(GAMEDATA, name)) as f:
        return json.load(f)


def build():
    skillgrp = load("skillgrp.json")
    skillsoundgrp = load("skillsoundgrp.json")

    # first row wins on the 6 conflicting duplicate keys (see parser notes)
    sounds = {}
    for x in skillsoundgrp:
        sounds.setdefault((x["skill_id"], x["skill_level"]), x["spell_sounds"])
    # skillsoundgrp carries only level-1 rows for almost every skill (10
    # exceptions, e.g. 4032/5007): higher levels inherit the base level's
    # sounds — the alternative (treating "no row" as "no sound") would make
    # every level 2+ needlessly differ from the base entry
    base_sounds = {}
    for (sid, lvl), snd in sounds.items():
        if sid not in base_sounds or lvl < base_sounds[sid][0]:
            base_sounds[sid] = (lvl, snd)

    def entry(rec):
        e = {
            "anim": rec["animation"],
            "magic": rec["is_magic"],
            "range": -1 if rec["cast_range"] == 0xFFFFFFFF else rec["cast_range"],
            "style": rec["cast_style"],
        }
        snd = sounds.get((rec["skill_id"], rec["skill_level"]))
        if snd is None and rec["skill_id"] in base_sounds:
            snd = base_sounds[rec["skill_id"]][1]
        if snd:
            s = {}
            if snd[0]:
                s["cast"] = snd[0]
            if snd[1]:
                s["shot"] = snd[1]
            if snd[2]:
                s["exp"] = snd[2]
            if s:
                e["snd"] = s
        return e

    by_id = {}
    for rec in skillgrp:
        by_id.setdefault(rec["skill_id"], []).append(rec)

    out = {}
    for sid, recs in by_id.items():
        recs.sort(key=lambda r: r["skill_level"])
        base = entry(recs[0])
        out[str(sid)] = base
        for rec in recs[1:]:
            e = entry(rec)
            if e != base:
                out[f"{sid}_{rec['skill_level']}"] = e
    return out


def sanity(out):
    assert out["3"]["anim"] == "S" and out["3"]["magic"] == 0
    assert out["3"]["range"] == 40
    assert out["3"]["snd"]["cast"] == "SkillSound.power_strike_cast"
    assert out["1216"]["anim"] == "D" and out["1216"]["range"] == -1
    assert out["1216"]["snd"]["cast"] == "SkillSound.heal_cast"
    assert out["1177"]["anim"] == "E" and out["1177"]["magic"] == 1
    assert out["1177"]["snd"]["exp"] == "SkillSound.wind_strike_explotion"
    assert out["271"]["anim"] == "N"          # Dance of the Warrior
    assert out["264"]["anim"] == "W"          # Song of Earth
    assert out["312"]["anim"] == ""           # Vicious Stance (passive)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()

    out = build()
    sanity(out)

    if args.check:
        if not os.path.exists(OUT_PATH):
            sys.exit("CHECK FAIL: skillanim.json missing")
        with open(OUT_PATH) as f:
            on_disk = json.load(f)
        if on_disk != out:
            sys.exit("CHECK FAIL: skillanim.json is stale — re-run the tool")
        print(f"CHECK PASS: {len(out)} entries, JSON in sync")
        return 0

    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"skillanim.json: {len(out)} entries "
          f"({sum(1 for k in out if '_' in k)} level overrides)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
