#!/usr/bin/env python3
"""ElberaSound — the retail audio pipeline.

Turns the Interlude client's audio into web-native assets:

  music   assets/interlude/music/*.ogg    -> assets/audio/music/*.ogg
          The client's music files ARE Ogg Vorbis; NCSoft only overwrote the
          4-byte "OggS" page capture pattern with "L2SD". Everything after
          byte 4 (version, header type, granule position, serial, CRC, the
          segment table) is an intact first Ogg page. So the conversion is a
          4-byte splice -- no re-encode, no quality loss.

  sfx     assets/interlude/sounds/*.uax   -> assets/audio/sfx/<pkg>/<name>.ogg
          25 encrypted UE2 sound packages. umodel decrypts and exports them as
          22.05 kHz PCM WAV (5,128 objects, ~537 MB); we transcode to Opus.
          Downmixed to MONO on purpose: the Web Audio PannerNode only
          spatializes mono sources, and every world sound in this game is
          positional (npcgrp/skillsoundgrp carry per-sound volume + radius).
          Stereo would silently defeat 3D audio.

The emitted manifest is keyed by the game's own reference syntax --
"ItemSound.sword_small_1", "MonSound.gremlin_dmg_1",
"SkillSound4.fatal_strike_cast" -- exactly as it appears in weapongrp.json,
npcgrp.json and skillsoundgrp.json, so the client resolves a sound by handing
over the string it already has. Lookup is case-insensitive because the tables
and the package filenames disagree on case (MonSound vs monsound.uax).

Usage:
  python3 tools/audio/build_audio.py            # music + sfx + manifest
  python3 tools/audio/build_audio.py --music    # one stage
  python3 tools/audio/build_audio.py --sfx
  python3 tools/audio/build_audio.py --check    # verify refs resolve, exit 1 on regression

Requires: tools/bin/umodel (vendored), ffmpeg with libopus.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CLIENT = os.path.join(ROOT, "assets", "interlude")
MUSIC_SRC = os.path.join(CLIENT, "music")
SOUND_SRC = os.path.join(CLIENT, "sounds")
OUT = os.path.join(ROOT, "assets", "audio")
OUT_MUSIC = os.path.join(OUT, "music")
OUT_SFX = os.path.join(OUT, "sfx")
UMODEL = os.path.join(ROOT, "tools", "bin", "umodel")
GAMEDATA = os.path.join(ROOT, "assets", "gamedata")

# NCSoft's marker on the first Ogg page. Same length as "OggS" by construction.
L2_MUSIC_MAGIC = b"L2SD"
OGG_MAGIC = b"OggS"

# 48k is transparent for 22 kHz mono foley and keeps 5k files under ~30 MB
# total. Opus in an Ogg container plays in Chrome, Firefox, Edge and Safari 17+.
OPUS_BITRATE = "48k"


# --------------------------------------------------------------------------
# music
# --------------------------------------------------------------------------

def convert_music(verbose=True):
    os.makedirs(OUT_MUSIC, exist_ok=True)
    names = sorted(n for n in os.listdir(MUSIC_SRC) if n.lower().endswith(".ogg"))
    written = skipped = 0
    for name in names:
        src = os.path.join(MUSIC_SRC, name)
        dst = os.path.join(OUT_MUSIC, name)
        with open(src, "rb") as fh:
            head = fh.read(4)
            if head == OGG_MAGIC:
                body = None          # already clean, copy verbatim
            elif head == L2_MUSIC_MAGIC:
                body = fh.read()
            else:
                skipped += 1
                if verbose:
                    print("  skip %s: unknown magic %r" % (name, head))
                continue
        if body is None:
            shutil.copyfile(src, dst)
        else:
            with open(dst, "wb") as out:
                out.write(OGG_MAGIC)
                out.write(body)
        written += 1
    if verbose:
        print("music: %d converted, %d skipped" % (written, skipped))
    return written


# --------------------------------------------------------------------------
# sfx
# --------------------------------------------------------------------------

def _export_banks(workdir, verbose=True):
    """Decrypt + unpack every .uax into workdir/<pkg>/Sound/<name>.wav."""
    banks = sorted(n for n in os.listdir(SOUND_SRC) if n.lower().endswith(".uax"))
    for name in banks:
        cmd = [UMODEL, "-export", "-sounds", "-out=" + workdir,
               os.path.join(SOUND_SRC, name)]
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True)
        if res.returncode != 0 and verbose:
            print("  umodel failed on %s: %s" % (name, res.stderr.decode(errors="replace")[:200]))
    if verbose:
        print("sfx: unpacked %d banks" % len(banks))
    return banks


def _transcode(job):
    src, dst = job
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    res = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", src,
         "-ac", "1",                       # mono: required for PannerNode
         "-c:a", "libopus", "-b:a", OPUS_BITRATE,
         "-application", "audio", dst],
        capture_output=True)
    if res.returncode != 0:
        return (dst, res.stderr.decode(errors="replace")[:200])
    return None


def convert_sfx(workdir=None, jobs=None, verbose=True):
    tmp = workdir or tempfile.mkdtemp(prefix="elbera-sfx-")
    owned = workdir is None
    try:
        _export_banks(tmp, verbose=verbose)
        queue = []
        for pkg in sorted(os.listdir(tmp)):
            sounds = os.path.join(tmp, pkg, "Sound")
            if not os.path.isdir(sounds):
                continue
            for fn in sorted(os.listdir(sounds)):
                if not fn.lower().endswith(".wav"):
                    continue
                dst = os.path.join(OUT_SFX, pkg, fn[:-4] + ".ogg")
                queue.append((os.path.join(sounds, fn), dst))

        if verbose:
            print("sfx: transcoding %d sounds to mono Opus..." % len(queue))
        errors = []
        with ProcessPoolExecutor(max_workers=jobs or os.cpu_count()) as pool:
            for err in pool.map(_transcode, queue, chunksize=16):
                if err:
                    errors.append(err)
        if verbose:
            print("sfx: %d written, %d failed" % (len(queue) - len(errors), len(errors)))
            for dst, msg in errors[:5]:
                print("  FAIL %s: %s" % (os.path.basename(dst), msg))
        return len(queue) - len(errors)
    finally:
        if owned:
            shutil.rmtree(tmp, ignore_errors=True)


# --------------------------------------------------------------------------
# manifest
# --------------------------------------------------------------------------

def build_bindings(verbose=True):
    """assets/audio/bindings.json — who plays what, indexed for the browser.

    npcgrp + skillsoundgrp + weapongrp are 9.5 MB of JSON and the client needs a
    few fields from each, so we join them here instead of shipping the tables.
    Sound names repeat heavily (three gremlin damage sounds are shared by every
    gremlin variant), so names go into one string table and every record holds
    indices into it -- that alone is most of the size saving.

      {"names": ["itemsound.sword_small_1", ...],
       "npc":    {"20001": {"a":[..], "d":[..], "m":[..], "v":50, "r":250}},
       "skill":  {"1": {"c":[..], "s":[..], "x":[..], "v":250, "r":50}},
       "weapon": {"1": {"h":[..], "e":idx, "d":idx}}}

    Keys are terse because they repeat thousands of times: a/d/m = attack /
    defense / damage, c/s/x = cast / shot / explosion, h/e/d = hit / equip /
    drop, v/r = volume / radius. Skills are keyed by id alone: levels of one
    skill share their sounds in every record checked, and keying by id+level
    would multiply the table ~10x for nothing.
    """
    names, index = [], {}

    def intern(ref):
        if not ref or "." not in ref:
            return None
        key = ref.lower()
        if key not in index:
            index[key] = len(names)
            names.append(key)
        return index[key]

    def intern_list(refs):
        out = [intern(r) for r in (refs or [])]
        return [i for i in out if i is not None]

    def load(name):
        with open(os.path.join(GAMEDATA, name)) as fh:
            return json.load(fh)

    npc = {}
    for r in load("npcgrp.json"):
        a = intern_list(r.get("attack_sound"))
        d = intern_list(r.get("defense_sound"))
        m = intern_list(r.get("damage_sound"))
        if not (a or d or m):
            continue
        rec = {}
        if a: rec["a"] = a
        if d: rec["d"] = d
        if m: rec["m"] = m
        rec["v"] = round(r.get("sound_vol") or 0)
        rec["r"] = round(r.get("sound_radius") or 0)
        npc[str(r["npc_id"])] = rec

    skill = {}
    for r in load("skillsoundgrp.json"):
        sid = str(r["skill_id"])
        if sid in skill:
            continue                      # first level wins; see docstring
        c = intern_list(r.get("spell_sounds"))
        s = intern_list(r.get("shot_sounds"))
        x = intern_list(r.get("exp_sounds"))
        if not (c or s or x):
            continue
        rec = {}
        if c: rec["c"] = c
        if s: rec["s"] = s
        if x: rec["x"] = x
        rec["v"] = round(r.get("sound_vol") or 0)
        rec["r"] = round(r.get("sound_rad") or 0)
        skill[sid] = rec

    weapon = {}
    for r in load("weapongrp.json"):
        h = intern_list(r.get("item_sound"))
        e = intern(r.get("equip_sound"))
        d = intern(r.get("drop_sound"))
        if not (h or e is not None or d is not None):
            continue
        rec = {}
        if h: rec["h"] = h
        if e is not None: rec["e"] = e
        if d is not None: rec["d"] = d
        weapon[str(r["object_id"])] = rec

    out = {"names": names, "npc": npc, "skill": skill, "weapon": weapon}
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "bindings.json")
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    if verbose:
        print("bindings: %d names, %d npc, %d skill, %d weapon -> %.1f KB"
              % (len(names), len(npc), len(skill), len(weapon),
                 os.path.getsize(path) / 1024.0))
    return out


def build_manifest(verbose=True):
    """{"sfx": {"itemsound.sword_small_1": "itemsound/sword_small_1.ogg"},
        "music": ["b01_f.ogg", ...]}

    Keys are lowercased "package.name" -- the tables reference sounds in mixed
    case and the client lowercases before lookup.
    """
    sfx = {}
    if os.path.isdir(OUT_SFX):
        for pkg in sorted(os.listdir(OUT_SFX)):
            d = os.path.join(OUT_SFX, pkg)
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if fn.endswith(".ogg"):
                    sfx["%s.%s" % (pkg.lower(), fn[:-4].lower())] = "%s/%s" % (pkg, fn)

    music = []
    if os.path.isdir(OUT_MUSIC):
        music = sorted(n for n in os.listdir(OUT_MUSIC) if n.endswith(".ogg"))

    manifest = {"sfx": sfx, "music": music}
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "manifest.json")
    with open(path, "w") as fh:
        json.dump(manifest, fh, separators=(",", ":"), sort_keys=True)
    if verbose:
        print("manifest: %d sfx, %d music -> %s" % (len(sfx), len(music), path))
    return manifest


# --------------------------------------------------------------------------
# check
# --------------------------------------------------------------------------

# The six references below do not resolve, and none of them is our bug:
# four name sounds absent from the Interlude banks (Antaras is a Hellbound-era
# raid), and two are malformed in NCSoft's own table -- one carries a stray
# ";[" separator gluing two names together, one repeats a word. Recorded here
# so --check stays at zero and a real regression is visible immediately.
KNOWN_UNRESOLVED = {
    "skillsound2.antaras_creak",
    "skillsound4.doublewind_explotion",
    "skillsound.fiend_wind_explotion",
    "monsound3.antars_ground_wave",
    "itemsound.public_sword_shing_3;[itemsound.sword_great_4",
    "itemsound.itemdrop_weapon_seize_mace_mace",
}


def _iter_refs():
    """Every sound reference the game data makes, as (source, "pkg.name")."""
    def rec(path):
        with open(os.path.join(GAMEDATA, path)) as fh:
            return json.load(fh)

    for r in rec("skillsoundgrp.json"):
        for key in ("spell_sounds", "shot_sounds", "exp_sounds"):
            for s in r.get(key, []):
                yield "skillsoundgrp", s
        for key in ("voice_cast", "voice_throw"):
            for s in (r.get(key) or {}).values():
                yield "skillsoundgrp", s
    for r in rec("weapongrp.json"):
        for s in r.get("item_sound", []):
            yield "weapongrp", s
        yield "weapongrp", r.get("drop_sound")
        yield "weapongrp", r.get("equip_sound")
    for r in rec("npcgrp.json"):
        for key in ("attack_sound", "defense_sound", "damage_sound"):
            for s in r.get(key, []):
                yield "npcgrp", s


def check(verbose=True):
    path = os.path.join(OUT, "manifest.json")
    if not os.path.exists(path):
        print("FAIL: no manifest at %s -- run the build first" % path)
        return 1
    with open(path) as fh:
        sfx = json.load(fh)["sfx"]

    seen, missing = set(), {}
    for source, ref in _iter_refs():
        if not ref or "." not in ref:
            continue
        key = ref.lower()
        seen.add(key)
        if key not in sfx:
            missing.setdefault(key, source)

    unexpected = sorted(set(missing) - KNOWN_UNRESOLVED)
    stale = sorted(KNOWN_UNRESOLVED - set(missing))

    if verbose:
        print("check: %d distinct refs, %d resolve, %d known-unresolved"
              % (len(seen), len(seen) - len(missing), len(missing)))
    if unexpected:
        print("FAIL: %d references no longer resolve:" % len(unexpected))
        for key in unexpected[:20]:
            print("  %s (from %s)" % (key, missing[key]))
        return 1
    if stale:
        print("NOTE: these are now resolving; drop them from KNOWN_UNRESOLVED:")
        for key in stale:
            print("  %s" % key)
    print("OK: %d/%d sound references resolve (%d known-bad in the source tables)"
          % (len(seen) - len(missing), len(seen), len(missing)))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--music", action="store_true", help="convert music only")
    ap.add_argument("--sfx", action="store_true", help="convert sound banks only")
    ap.add_argument("--manifest", action="store_true", help="rebuild the manifest only")
    ap.add_argument("--bindings", action="store_true", help="rebuild the binding index only")
    ap.add_argument("--check", action="store_true", help="verify game-data refs resolve")
    ap.add_argument("--jobs", type=int, default=None, help="transcode workers (default: cpu count)")
    ap.add_argument("--keep", metavar="DIR", help="unpack WAVs here and keep them")
    args = ap.parse_args()

    if args.check:
        return check()

    stages = (args.music, args.sfx, args.manifest, args.bindings)
    run_all = not any(stages)

    if run_all or args.music:
        convert_music()
    if run_all or args.sfx:
        convert_sfx(workdir=args.keep, jobs=args.jobs)
    if run_all or args.manifest or args.music or args.sfx:
        build_manifest()
    if run_all or args.bindings:
        build_bindings()
    if run_all:
        return check()
    return 0


if __name__ == "__main__":
    sys.exit(main())
