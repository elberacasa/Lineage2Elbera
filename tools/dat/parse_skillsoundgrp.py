#!/usr/bin/env python3
"""Elbera Tools: decode original Interlude skillsoundgrp.dat sound records.

Protocol413 RSA wrapper, record count, fixed-layout records, SafePackage
trailer; assert full byte consumption. Native serializer at Engine.dll14ec30
proves THREE LAYERS, each containing cast/shot/explosion names and interleaved
(volume,radius) pairs. Existing spell/shot/exp JSON group names are retained for
compatibility: they identify layers0/1/2, not sound phases or alternatives.

Then two 15-name voice arrays (cast,throw), followed by voice volume/radius.
Native GetMeshType maps ordinary playable models to slots0..13; slot14 is
preserved, not discarded. Native playback loops all populated phase layers
and then the corresponding voice. There is no per-phase gain fallback to the
voice pair. Zero gains and all duplicate/empty skill-ID/level rows are source.

Proof: tools/ui/check_cast_sound_native.py freshly decrypts and decodes the
DAT independently and verifies original loader, lookup, playback instructions,
all28 named voice stores, and the source model-index access. Historical
filename/statistical/emulator comparisons below are sanity checks, not proof
of dispatch or timing. See docs/native-cast-sound-evidence.md for limits.

Usage:
  python3 tools/dat/parse_skillsoundgrp.py          # write private JSON
  python3 tools/dat/parse_skillsoundgrp.py --check  # verify private JSON
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
            # Native serializer14ec30 confirms the interleaved gain stores.
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
