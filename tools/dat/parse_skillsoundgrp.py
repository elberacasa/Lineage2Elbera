#!/usr/bin/env python3
"""Decode assets/interlude/system/skillsoundgrp.dat -> assets/gamedata/skillsoundgrp.json.

skillsoundgrp.dat is the retail per-skill SOUND presentation table: for each
(skill_id, skill_level) it carries the cast/shot/explosion sound references,
their volumes/radii, and the per race/gender character VOICE sounds played
during the cast and at the shot. It carries NO animation names and NO effect
texture references (verified: every string parses as a SkillSound.*/chrsound.*
sound ref; the cast ANIMATION selector is skillgrp.dat's `animation` field —
see docs/dat-format-notes.md §16 and the client Engine.Pawn anim sets).

Protocol 413 RSA wrapper (removed by tools/bin/l2encdec), then:
  UINT record count (1398), fixed-layout records, `\x0cSafePackage\x00` trailer.
The parser asserts exact byte consumption, like extract_gamedata.py.

Record layout (ScionsOfDestiny block — L2Miko/L2FileEdit
DAT_defs/Interlude/skillsoundgrp.ddf and majestic-world/L2ClientDat
dats/skillsoundgrp.xml agree; both validated byte-exact against our file):

  skill_id        UINT
  skill_level     UINT
  spell_sounds    UNICODE x3   cast / shot(launch) / explosion(hit) sound refs
  spell_vols      FLOAT x3     (sound volume, 250 typical; 0 for empty slots)
  spell_rads      FLOAT x3     (audible radius, 40/250/80 typical)
  shot_sounds     UNICODE x3   rarely used (111/1398 records)
  shot_vols/rads  FLOAT x3
  exp_sounds      UNICODE x3   rarely used (4/1398 records)
  exp_vols/rads   FLOAT x3
  voice_cast[15]  UNICODE      per race/gender cast voice (chrsound.* theme:
                               white/black/element/type_a/b/c/sub/call)
  voice_throw[15] UNICODE      per race/gender shot voice (chrsound.*_throw /
                               *_shot / *_notarget)
  sound_vol       FLOAT        250.0 in all 1398 records
  sound_rad       FLOAT        50.0 in all 1398 records

voice order (chargrp record order, same as ITEM_RACE_SLOTS in
extract_gamedata.py): mfighter ffighter mdarkelf fdarkelf mdwarf fdwarf
melf felf mmagic fmagic morc forc mshaman fshaman + a trailing RESERVED
slot (always empty).

Verified anchors (skillname.json + aCis agree on the ids):
  (3,1)    Power Strike  -> SkillSound.power_strike_cast / _shot
  (1216,1) Self Heal     -> SkillSound.heal_cast / heal_shot, voice theme
                            "white" (holy magic), shot voice "*_notarget"
  (1177,1) Wind Strike   -> wind_strike_cast / _shot / _explotion, voice
                            theme "element"

Usage:
  /usr/bin/python3 tools/dat/parse_skillsoundgrp.py           # write JSON
  /usr/bin/python3 tools/dat/parse_skillsoundgrp.py --check   # verify only
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from l2dat import Reader  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SYSTEM_DIR = os.path.join(ROOT, "assets", "interlude", "system")
L2ENCDEC = os.path.join(ROOT, "tools", "bin", "l2encdec")
OUT_PATH = os.path.join(ROOT, "assets", "gamedata", "skillsoundgrp.json")

TRAILER = b"\x0cSafePackage\x00"

# chargrp record order (extract_gamedata.py ITEM_RACE_SLOTS uses the same)
VOICE_SLOTS = [
    "mfighter", "ffighter", "mdarkelf", "fdarkelf", "mdwarf", "fdwarf",
    "melf", "felf", "mmagic", "fmagic", "morc", "forc",
    "mshaman", "fshaman", "RESERVED",
]


def parse_skillsoundgrp(data: bytes):
    assert data.endswith(TRAILER), "skillsoundgrp.dat: missing SafePackage trailer"
    r = Reader(data[:-len(TRAILER)], "skillsoundgrp.dat")
    records = []
    for _ in range(r.u32()):
        rec = {"skill_id": r.u32(), "skill_level": r.u32()}
        for grp in ("spell", "shot", "exp"):
            rec[grp + "_sounds"] = [r.ustr() for _ in range(3)]
            rec[grp + "_vols"] = [r.f32() for _ in range(3)]
            rec[grp + "_rads"] = [r.f32() for _ in range(3)]
        rec["voice_cast"] = {slot: r.ustr() for slot in VOICE_SLOTS}
        rec["voice_throw"] = {slot: r.ustr() for slot in VOICE_SLOTS}
        rec["sound_vol"] = r.f32()
        rec["sound_rad"] = r.f32()
        records.append(rec)
    assert r.done(), f"skillsoundgrp: {len(r.data) - r.pos} bytes left"
    return records


def sanity(records):
    """Anchor checks against known-retail content (fail loudly on drift)."""
    by_key = {}
    for x in records:
        k = (x["skill_id"], x["skill_level"])
        # the retail file carries 11 duplicated (id, level) rows:
        # 1012/1031/1217/4032/4119 are byte-identical repeats; 4178, 4180,
        # 4208, 4513, 4514, 5007 repeat with DIFFERENT sounds (both rows are
        # real file content — kept verbatim; lookups take the FIRST row)
        by_key.setdefault(k, x)
    assert (3, 1) in by_key, "Power Strike missing"
    assert by_key[(3, 1)]["spell_sounds"][0] == "SkillSound.power_strike_cast"
    assert by_key[(3, 1)]["spell_sounds"][1] == "SkillSound.power_strike_shot"
    assert by_key[(1216, 1)]["spell_sounds"][0] == "SkillSound.heal_cast"
    assert by_key[(1216, 1)]["voice_cast"]["mmagic"] == "chrsound.m_hmagician_white"
    assert by_key[(1177, 1)]["spell_sounds"][2] == "SkillSound.wind_strike_explotion"
    assert by_key[(1177, 1)]["voice_cast"]["melf"] == "chrsound.m_elf_element"
    # every populated sound ref lives in a known package namespace
    for x in records:
        for grp in ("spell", "shot", "exp"):
            for s in x[grp + "_sounds"]:
                assert not s or "." in s, f"bad sound ref {s!r}"
        for blk in ("voice_cast", "voice_throw"):
            for slot, s in x[blk].items():
                assert not s or s.startswith("chrsound."), f"bad voice ref {s!r}"
                if slot == "RESERVED":
                    assert not s, "RESERVED voice slot populated"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()

    workdir = tempfile.mkdtemp(prefix="l2skillsound_")
    dec = os.path.join(workdir, "skillsoundgrp.dat.dec")
    subprocess.run([L2ENCDEC, "-c", "decode", "-p", "413", "-o", dec,
                    os.path.join(SYSTEM_DIR, "skillsoundgrp.dat")],
                   check=True, capture_output=True)
    with open(dec, "rb") as f:
        records = parse_skillsoundgrp(f.read())
    sanity(records)

    if args.check:
        # also verify the on-disk JSON is in sync
        if not os.path.exists(OUT_PATH):
            sys.exit("CHECK FAIL: skillsoundgrp.json missing")
        with open(OUT_PATH) as f:
            on_disk = json.load(f)
        if on_disk != records:
            sys.exit("CHECK FAIL: skillsoundgrp.json is stale — re-run the parser")
        print(f"CHECK PASS: {len(records)} records, JSON in sync")
        return 0

    with open(OUT_PATH, "w") as f:
        json.dump(records, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"skillsoundgrp.dat -> {os.path.relpath(OUT_PATH, ROOT)} "
          f"({len(records)} records)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
