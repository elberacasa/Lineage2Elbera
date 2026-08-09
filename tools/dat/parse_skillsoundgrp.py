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
  spell gains     FLOAT x6     THREE (volume, radius) PAIRS, one per slot
  shot_sounds     UNICODE x3   rarely used (111/1398 records)
  shot gains      FLOAT x6     same three (volume, radius) pairs
  exp_sounds      UNICODE x3   rarely used (4/1398 records)
  exp gains       FLOAT x6     same three (volume, radius) pairs

THE SIX FLOATS ARE INTERLEAVED (volume, radius) PAIRS, NOT two blocked
arrays (CORRECTED 2026-08-09).  Until this date the parser read them as
`vols[3]` then `rads[3]`, which is what the third-party .ddf/.xml field
NAMES suggest.  Three independent measurements say otherwise:

  1. CORRELATION.  A populated sound slot should carry a nonzero volume
     and radius and an empty one should carry zeros.  Over all 1398
     records x 3 groups x 3 slots (4194 slots):
        blocked  vols[3]+rads[3]      2940 agree / 1254 disagree
        paired   (v,r)(v,r)(v,r)      4173 agree /   21 disagree
     and on the `shot` and `exp` groups the paired reading is 4194/4194
     with ZERO disagreements.
  2. THE BYTE RULE.  `SoundVolume` is a **ByteProperty** and `SoundRadius`
     a **FloatProperty** — read straight out of Engine.u's exports for
     `AmbientSound` / `AmbientSoundObject` (they sit at export 5536/5563
     and 10507/10508), and quoted in tools/world/audio_extract.py from the
     same class declarations.  So a volume cannot exceed 255.
        paired:  volume domain {0, 150, 220, 250, 254}  — all byte-legal
                 radius domain {0, 20, 30, 40, 60, 80, 100, 200, 600, 800}
        blocked: "volume" domain includes 600 and 800 — impossible
     The paired reading is the only one whose first element is a byte.
  3. SELF-CONSISTENCY.  The trailing scalars are (sound_vol 250,
     sound_rad 50) in every one of the 1398 records, and 250 is exactly
     the modal per-slot FIRST element (2319 of the populated spell slots
     are (250, 40)).  Under the swapped reading the record would claim a
     global volume of 250 and a per-slot volume of 40.

  Concretely, Wind Strike (1177) reads 250,40 | 250,40 | 250,80: cast and
  shot at volume 250 / radius 40, the explosion at volume 250 / radius 80
  — and 80 is GAudioDefaultRadius from Core.dll (see js/audio.js).  The
  old reading gave the shot volume 40 and radius 250, and gave 951 shot
  sounds a radius of ZERO.

  WHAT WOULD FALSIFY THIS: a record whose first element of a pair exceeds
  255, or a populated slot whose pair is (0, 0) beyond the 22 exceptions
  asserted in sanity() below.  Both are checked on every run.
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
            # SIX floats = THREE (volume, radius) pairs, one per sound slot.
            # See the module docstring for the three measurements that settle
            # this against the blocked vols[3]+rads[3] reading.
            gains = [r.f32() for _ in range(6)]
            rec[grp + "_vols"] = gains[0::2]
            rec[grp + "_rads"] = gains[1::2]
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
    # ---- the (volume, radius) pairing, asserted so a regression is loud ----
    #
    # These three gates FAIL on the pre-2026-08-09 blocked reading. They are
    # not decoration: the blocked reading gave 951 shot sounds a radius of 0
    # and claimed volumes of 600 and 800.
    vols, rads, bad_pairs = set(), set(), []
    for x in records:
        for grp in ("spell", "shot", "exp"):
            for i, s in enumerate(x[grp + "_sounds"]):
                v, rr = x[grp + "_vols"][i], x[grp + "_rads"][i]
                vols.add(v)
                rads.add(rr)
                if bool(s) != (v > 0 and rr > 0):
                    bad_pairs.append((x["skill_id"], x["skill_level"], grp, i))
    # gate 1: SoundVolume is a ByteProperty (Engine.u AmbientSoundObject) --
    # nothing in the volume column may exceed 255. The blocked reading puts
    # 600 and 800 here.
    assert max(vols) <= 255.0, (
        "skillsoundgrp: volume column holds %r > 255 -- SoundVolume is a "
        "ByteProperty, so the volume/radius columns are swapped"
        % sorted(v for v in vols if v > 255.0))
    # gate 2: the radius column must actually be a radius, i.e. it must reach
    # past a byte somewhere (600/800 = 300-400 m at Core.dll's
    # GAudioMaxRadiusMultiplier 50). If it never does, the columns are swapped.
    assert max(rads) > 255.0, (
        "skillsoundgrp: radius column never exceeds 255 -- columns look swapped")
    # gate 3: a populated slot carries a gain pair and an empty one does not.
    # 22 retail rows break this (21 spell slots that keep a gain pair with no
    # sound, and skill 5113's shock_shot which carries no pair); every one is
    # named so the count cannot silently grow.
    KNOWN_UNPAIRED = {
        (426, 1, "spell", 1), (427, 1, "spell", 1), (1426, 1, "spell", 1),
        (1427, 1, "spell", 1), (1428, 1, "spell", 1), (3206, 1, "spell", 1),
        (3627, 1, "spell", 2), (3628, 1, "spell", 2), (3632, 1, "spell", 2),
        (5113, 1, "spell", 1), (5123, 1, "spell", 1), (5125, 1, "spell", 1),
        (5126, 1, "spell", 1), (5127, 1, "spell", 1), (5128, 1, "spell", 1),
        (5129, 1, "spell", 1), (5130, 1, "spell", 1), (5131, 1, "spell", 1),
        (5132, 1, "spell", 1), (5133, 1, "spell", 1), (5134, 1, "spell", 1),
        (5135, 1, "spell", 1),
    }
    unexpected = [p for p in bad_pairs if p not in KNOWN_UNPAIRED]
    assert not unexpected, (
        "skillsoundgrp: %d slot(s) whose sound and gain pair disagree beyond "
        "the 22 known retail rows, first 5: %s"
        % (len(unexpected), unexpected[:5]))
    # anchor: Wind Strike's three slots, the skill whose sounds are named in
    # docs/skillfx-data.md. cast/shot at radius 40, explosion at radius 80.
    ws = by_key[(1177, 1)]
    assert ws["spell_vols"] == [250.0, 250.0, 250.0], ws["spell_vols"]
    assert ws["spell_rads"] == [40.0, 40.0, 80.0], ws["spell_rads"]

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
