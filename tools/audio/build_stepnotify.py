#!/usr/bin/env python3
"""build_stepnotify.py - WHEN a footstep fires, and WHICH .ogg it plays.

This is the half of the footstep rule that build_steps.py left undecoded.
Both answers are in the shipped .ukx; neither is inferred from a name.

---------------------------------------------------------------------------
1. THE ANIMATION DATA IS READABLE, AND IT CARRIES THE FOOTFALLS
---------------------------------------------------------------------------
A UMeshAnimation export (`MFighter_anim` in animations/Fighter.ukx) serializes,
after the UObject property stream:

    i32                       Version                     (= 1)
    TArray<FNamedBone>        RefBones   { cidx Name; i32 Flags; i32 Parent; }
    i32                       AnimSeqsOffset   <-- Lineage2 only
    cidx                      MoveCount
    ... MotionChunk[MoveCount], the compressed tracks, which we SKIP ...

`AnimSeqsOffset` is an ABSOLUTE file offset. umodel's Lineage2 branch reads
this same pair (`Ar << pos << count`) before the moves; the offset is what
lets this tool jump the compressed FlexTrack data entirely and land on:

    cidx                      AnimSeqCount
    i32                       (0)
    FMeshAnimSeq[AnimSeqCount]:
        cidx                  Name
        TArray<cidx>          Groups            (always empty in Interlude)
        i32                   StartFrame
        i32                   NumFrames
        TArray<FMeshAnimNotify>:
            f32               Time      -- NORMALIZED 0..1 over the sequence
            cidx              Function  -- always 'None' in Interlude
            cidx              NotifyObject -- an export index
        f32                   Rate      -- frames per second
        ... a per-sequence trailer this tool does not need to interpret ...

The trailer's length is NOT constant, so records are located rather than
walked: for each sequence umodel itself reports, this tool searches forward
from the previous record's end for the first offset that parses as that
sequence AND whose NumFrames and Rate equal umodel's. umodel is the oracle
in both directions -- if the layout above were wrong, no offset would satisfy
all three, and the tool fails instead of emitting anything. Measured: 114/114
sequences for MFighter_anim, and every sequence of all 14 playable pawns.

---------------------------------------------------------------------------
2. AnimNotify_Sound OBJECTS CARRY THE EIGHT BANKS, POPULATED
---------------------------------------------------------------------------
build_steps.py recorded that the eight arrays are declared `var`, not `var()`,
with no defaultproperties, and refused to guess which .ogg fills each. It did
not need to be guessed: every AnimNotify_Sound export in every .ukx serializes
all eight arrays, all three elements each, in its own PACKED (UE1-style)
property list. Read out of animations/Fighter.ukx, and byte-identical across
all 336 step notifies of all 14 playable pawns:

    DefaultWalkSound       StepSound.default_walk_01/_02/_03
    DefaultRunSound        StepSound.default_run_01/_02/_03
    GrassWalkSound         StepSound.grass_walk_01/_02/_03
    GrassRunSound          StepSound.grass_run_01/_02/_02   <-- retail's own
                           duplicate: slot 3 repeats slot 2. NOT a read error;
                           it is what the package contains, and it is emitted
                           verbatim rather than "corrected" to grass_run_03.
    WaterWalkSound         StepSound.water_shalow_01/_02/_03
    WaterRunSound          StepSound.water_shalow_01/_02/_03  <-- water RUN is
                           the same three files as water WALK.
    DefaultActorWalkSound  StepSound.Stone_Hard_Walk_01/_02/_03
    DefaultActorRunSound   StepSound.Stone_Hard_Run_01/_02/_03

So the two open questions are closed by the data: WATER is SHALOW (deep is
never referenced by a pawn notify), and the package is StepSound, not
ChrSound. Note this settles it only for the PAWN banks; per-actor
StepSound_1..3 (build_steps.py) do reference chrsound.* freely.

Volume and Radius are NOT constant and are therefore carried per step rather
than hoisted: Volume is 250 on all 336, Radius is 30 on 335 and 60 on exactly
one -- the second footfall of Walk_Dual_Mshaman. That is what the package
says, and it is emitted as-is. audio.js consumes both as the raw table values
it already takes.

---------------------------------------------------------------------------
3. WHICH NOTIFY IS A FOOTSTEP
---------------------------------------------------------------------------
Every AnimNotify_Sound carries the eight banks, including ones that are
plainly not footsteps (`Sound = ChrSound.MHFighter_Breath_1, Random 5`, on
the run cycles). The discriminator is the `Sound` property itself:

    Sound present  -> the notify plays that sound.
    Sound absent   -> the notify has nothing to play but a step bank.

That is a reading of the class, so it is checked rather than trusted, and the
check is exhaustive over all 14 pawns:
  * every Walk_* and Run_* sequence has EXACTLY TWO Sound-less
    AnimNotify_Sound -- one per foot;
  * no sequence outside Walk_*/Run_* has a Sound-less one at all.
168 locomotion sequences, 336 step notifies, zero exceptions. A rule that
picked the wrong notifies could not produce that.

---------------------------------------------------------------------------
4. STILL UNDECODED (not guessed, not written)
---------------------------------------------------------------------------
  * What makes terrain read GRASS rather than LAND. TerrainLayer has no sound
    field (build_steps.py), the decision is in packed engine.dll, and nothing
    in the .unr distinguishes them. The grass bank is EXTRACTED here and is
    unreachable at runtime until that is decoded.
  * The GRASS/LAND/WATER/ACTOR <-> Default/Grass/Water/DefaultActor pairing
    for GRASS, WATER and ACTOR is by name; LAND<->Default then follows by
    elimination over the 4-element enum. The names are exact for three of
    four, and no fifth array exists.
  * Monsters and NPCs. LineageMonsters*/LineageNpcs*/lineagenpcsev use the
    same AnimNotify_Sound class and this tool reads them with no change, but
    the client's monster clips are not name-mapped here. Players only.

---------------------------------------------------------------------------
WHAT THIS WRITES
---------------------------------------------------------------------------
    assets/audio/stepnotify.json

        {"banks": {"land"|"grass"|"water"|"actor": {"walk":[3],"run":[3]}},
         "pawns": {"<model id>": {"clips": {"walk_1hs": {
              "seq","gait","frames","rate","steps":[{"t","u","volume","radius"}]}}}}}

`t` is retail's own normalized notify time over the sequence. `u` is that
time as a fraction of the SHIPPED glTF clip's duration, which is what the
client can actually seek: build_characters.py writes key i at i/Rate seconds
for i in 0..NumFrames-1, so the clip lasts (NumFrames-1)/Rate while retail's
sequence lasts NumFrames/Rate, and u = t*NumFrames/(NumFrames-1) puts the
step on the same POSE it was authored on. That relation is asserted against
every shipped .gltf (key count == NumFrames, last key == (NumFrames-1)/Rate)
-- see check_gltf() -- so it is verified, not assumed.

Usage:
  python3 tools/audio/build_stepnotify.py            # write it
  python3 tools/audio/build_stepnotify.py --check    # re-derive, diff, no write
"""

import argparse
import json
import os
import struct
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tools", "world"))

from l2lib import load_package, read_properties, L2Error       # noqa: E402
from l2lib.ue2package import Reader, encode_compact             # noqa: E402
from convert import read_props_ordered                          # noqa: E402

CLIENT = os.path.join(ROOT, "assets", "interlude")
ANIMS = os.path.join(CLIENT, "animations")
PSA = os.path.join(ROOT, "tools", "anim", "psa")
OUT = os.path.join(ROOT, "assets", "audio", "stepnotify.json")
MANIFEST = os.path.join(ROOT, "assets", "audio", "manifest.json")
MODELS = os.path.join(ROOT, "editor", "characters", "models")
CHARMANIFEST = os.path.join(ROOT, "editor", "characters", "manifest.json")

# (client model id, .ukx package, anim-object/sequence prefix).
# Verbatim from tools/src/char_pipeline/build_characters.py COMBOS columns
# 0/4/5 -- the same table that decided which sequences became which glTF
# clips. Asserted against it in main() so the two cannot drift apart.
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

# The six stance tokens, in the client's own handness order
# (editor/characters/stances.json, sourced from NWindow.dll).
STANCES = ["hand", "1hs", "2hs", "dual", "bow", "pole"]

# The unstanced pair. build_characters.py ANIM_CANDIDATES:
#   'walk': ['Walk_Hand_{P}', 'Walk_1HS_{P}'], 'run': ['Run_Hand_{P}', ...]
# first candidate that exists wins -- reproduced exactly.
LEGACY = {"walk": ["Walk_Hand_{P}", "Walk_1HS_{P}"],
          "run":  ["Run_Hand_{P}", "Run_1HS_{P}"]}

BANK_PROPS = {
    "land":  ("DefaultWalkSound", "DefaultRunSound"),
    "grass": ("GrassWalkSound", "GrassRunSound"),
    "water": ("WaterWalkSound", "WaterRunSound"),
    "actor": ("DefaultActorWalkSound", "DefaultActorRunSound"),
}

PROP_BYTE, PROP_INT, PROP_BOOL, PROP_FLOAT, PROP_OBJECT = 1, 2, 3, 4, 5


# --------------------------------------------------------------------------
# umodel's .psa, used only as the oracle for (name, NumFrames, Rate)
# --------------------------------------------------------------------------
def psa_seqs(path):
    with open(path, "rb") as fh:
        d = fh.read()
    o, chunks = 0, {}
    while o < len(d):
        cid = d[o:o + 20].split(b"\0")[0].decode("ascii", "replace")
        dsz, dcnt = struct.unpack("<ii", d[o + 24:o + 32])
        o += 32
        chunks[cid] = (o, dsz, dcnt)
        o += dsz * dcnt
    if "ANIMINFO" not in chunks:
        raise L2Error("%s: no ANIMINFO chunk" % path)
    off, dsz, dcnt = chunks["ANIMINFO"]
    out = []
    for i in range(dcnt):
        b = d[off + i * dsz:off + (i + 1) * dsz]
        name = b[0:64].split(b"\0")[0].decode("ascii", "replace")
        v = struct.unpack("<iiiifffiii", b[128:168])
        out.append((name, v[9], v[6]))       # name, NumRawFrames, AnimRate
    return out


# --------------------------------------------------------------------------
# the .ukx
# --------------------------------------------------------------------------
def anim_seqs_offset(pkg, exp):
    """Absolute file offset of the MeshAnimation's FMeshAnimSeq array."""
    r = pkg.body_reader(exp)
    read_properties(pkg, r)                  # empty; just the 'None' terminator
    r.i32()                                  # Version
    for _ in range(r.compact()):             # RefBones
        r.compact(); r.i32(); r.i32()
    return r.i32()                           # Lineage2 AnimSeqs offset


def _try_record(pkg, off, end, want_frames, want_rate):
    """Parse one FMeshAnimSeq at `off`, or None if the bytes are not one."""
    r = Reader(pkg.data, off, path=pkg.path)
    try:
        ni = r.compact()
        if not 0 <= ni < len(pkg.names):
            return None
        name = pkg.names[ni]
        ng = r.compact()
        if not 0 <= ng <= 8:
            return None
        for _ in range(ng):
            if not 0 <= r.compact() < len(pkg.names):
                return None
        start = r.i32()
        frames = r.i32()
        if frames != want_frames:
            return None
        nn = r.compact()
        if not 0 <= nn <= 64:
            return None
        notifys = []
        for _ in range(nn):
            t = r.f32()
            fn = r.compact()
            obj = r.compact()
            # Retail ships notifies that never fire: Atk01_Hand_MElf's 7th
            # has Time 1.86 (past the end of its own sequence) and a NULL
            # NotifyObject. Rejecting those cost the whole record, so the
            # bounds here are only wide enough to keep random floats and
            # wild indices from parsing -- the (name, NumFrames, Rate)
            # triple and the ordering do the real discriminating.
            if not -1e3 <= t <= 1e3:
                return None
            if not 0 <= fn < len(pkg.names):
                return None
            if not 0 <= obj <= len(pkg.exports):
                return None
            notifys.append((t, pkg.names[fn], obj))
        rate = r.f32()
        if abs(rate - want_rate) > 1e-4:
            return None
        if r.pos > end:
            return None
        return {"name": name, "start": start, "frames": frames, "rate": rate,
                "notifys": notifys, "end": r.pos}
    except (L2Error, IndexError, struct.error, UnicodeDecodeError):
        return None


def read_sequences(pkg, exp, oracle):
    """-> [record], one per sequence umodel reports, in umodel's order."""
    cursor = anim_seqs_offset(pkg, exp)
    end = exp.serial_offset + exp.serial_size
    first = {}
    for i, n in enumerate(pkg.names):
        first.setdefault(n, i)
    out, missing = [], []
    for name, frames, rate in oracle:
        if name not in first:
            missing.append(name)
            continue
        pat = encode_compact(first[name])
        o, hit = cursor, None
        while True:
            k = pkg.data.find(pat, o, end)
            if k < 0:
                break
            rec = _try_record(pkg, k, end, frames, rate)
            if rec and rec["name"] == name:
                hit = rec
                break
            o = k + 1
        if hit is None:
            missing.append(name)
            continue
        out.append(hit)
        cursor = hit["end"]
    return out, missing


def notify_props(pkg, obj_index):
    """Packed property list of an AnimNotify_* export -> {name: {index: val}}."""
    exp = pkg.exports[obj_index - 1]
    props, _end = read_props_ordered(pkg, exp.serial_offset)
    out = {}
    for p in props:
        t, raw = p["type"], p["raw"]
        if t == PROP_OBJECT:
            ref = pkg.ref_name(Reader(raw).compact())
            val = ("%s.%s" % ref) if ref and ref[0] else (ref[1] if ref else None)
        elif t == PROP_FLOAT:
            val = struct.unpack("<f", raw)[0]
        elif t == PROP_INT:
            val = struct.unpack("<i", raw)[0]
        elif t == PROP_BYTE:
            val = raw[0]
        elif t == PROP_BOOL:
            val = p["boolval"]
        else:
            val = raw.hex()
        out.setdefault(p["name"], {})[p["index"]] = val
    return pkg.class_name_of(exp), out


def bank_of(props, name):
    """The three elements of one sound array, in slot order, lowercased."""
    d = props.get(name, {})
    return [str(d[i]).lower() for i in sorted(d)] if d else None


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------
def build(stats):
    pawns, banks = {}, None
    for model_id, package, prefix in PAWNS:
        ukx = os.path.join(ANIMS, package + ".ukx")
        pkg, _proto = load_package(ukx)
        anim = "%s_anim" % prefix
        exp = None
        for e in pkg.exports:
            if (pkg.class_name_of(e) == "MeshAnimation"
                    and pkg.export_name(e).lower() == anim.lower()):
                exp = e
                break
        if exp is None:
            raise L2Error("%s: no MeshAnimation %s" % (ukx, anim))
        psa = os.path.join(PSA, package, "MeshAnimation",
                           pkg.export_name(exp) + ".psa")
        if not os.path.exists(psa):
            raise L2Error("%s missing -- run tools/anim/export_psa.sh, or "
                          "umodel -export animations/%s.ukx" % (psa, package))
        oracle = psa_seqs(psa)
        seqs, missing = read_sequences(pkg, exp, oracle)
        stats["sequences"] += len(seqs)
        stats["sequences_unlocated"] += len(missing)
        by_name = {}
        for s in seqs:
            by_name.setdefault(s["name"].lower(), s)

        # --- the step notifies, and the invariants that prove the rule ---
        for s in seqs:
            steps = []
            for t, _fn, obj in s["notifys"]:
                if obj == 0:
                    continue                    # a null NotifyObject
                cls, props = notify_props(pkg, obj)
                if cls != "AnimNotify_Sound" or "Sound" in props:
                    continue
                stats["step_notifies"] += 1
                if not 0.0 <= t <= 1.0:
                    stats["steps_off_timeline"] += 1
                    continue
                steps.append((t, props.get("Volume", {}).get(0),
                              props.get("Radius", {}).get(0)))
                b = {k: {"walk": bank_of(props, w), "run": bank_of(props, r)}
                     for k, (w, r) in BANK_PROPS.items()}
                if banks is None:
                    banks = b
                elif b != banks:
                    stats["divergent_banks"] += 1
            s["steps"] = sorted(steps)
            action = s["name"].split("_")[0].lower()
            if action in ("walk", "run"):
                if len(steps) != 2:
                    stats["locomotion_not_two_steps"] += 1
            elif steps:
                stats["steps_outside_locomotion"] += 1

        # --- name the sequences the way the client names its clips ---
        clips = {}

        def add(clip_name, seq_name):
            s = by_name.get(seq_name.lower())
            if not s:
                return False
            if len(s["steps"]) != 2:
                stats["clips_without_two_steps"] += 1
                return False
            f, rate = s["frames"], s["rate"]
            if f < 2 or rate <= 0:
                stats["clips_bad_timeline"] += 1
                return False
            clips[clip_name] = {
                "seq": s["name"], "gait": s["name"].split("_")[0].lower(),
                "frames": f, "rate": rate,
                "steps": [{"t": round(t, 6), "u": round(t * f / (f - 1), 6),
                           "volume": vol, "radius": rad}
                          for (t, vol, rad) in s["steps"]],
            }
            return True

        for action, base in (("walk", "Walk"), ("run", "Run")):
            for st in STANCES:
                add("%s_%s" % (action, st),
                    "%s_%s_%s" % (base, st.upper() if st != "hand" else "Hand",
                                  prefix))
            for cand in LEGACY[action]:
                if add(action, cand.replace("{P}", prefix)):
                    break
            else:
                stats["legacy_clip_missing"] += 1

        pawns[model_id] = {"package": package, "anim": pkg.export_name(exp),
                           "prefix": prefix, "clips": clips}
        stats["clips"] += len(clips)

    doc = {
        "generated_by": "tools/audio/build_stepnotify.py",
        "source": {
            "when": "AnimNotify_Sound entries on the Walk_*/Run_* FMeshAnimSeq "
                    "of assets/interlude/animations/<Pkg>.ukx; `t` is retail's "
                    "own normalized notify time, `u` the same instant as a "
                    "fraction of the shipped glTF clip",
            "which": "the eight sound arrays serialized on every "
                     "AnimNotify_Sound export (packed UE1 property list)",
            "oracle": "umodel .psa ANIMINFO (name, NumRawFrames, AnimRate) "
                      "locates and validates every sequence record",
        },
        "banks": banks,
        "pawns": pawns,
    }
    return doc


def check_gltf(doc, stats):
    """The shipped clip must have NumFrames keys ending at (NumFrames-1)/Rate.

    That relation is the whole basis for `u`. It is read out of the .gltf
    accessors, so a pipeline change that reframes a clip fails here instead
    of silently sliding every footstep out of phase.
    """
    for model_id, pawn in doc["pawns"].items():
        path = os.path.join(MODELS, model_id + ".gltf")
        if not os.path.exists(path):
            stats["gltf_missing"] += 1
            continue
        with open(path) as fh:
            g = json.load(fh)
        acc = g["accessors"]
        anims = {a["name"]: a for a in g.get("animations", [])}
        for clip_name, c in pawn["clips"].items():
            a = anims.get(clip_name)
            if a is None:
                stats["gltf_clip_missing"] += 1
                continue
            want_last = (c["frames"] - 1) / c["rate"]
            ok = False
            for s in a["samplers"]:
                ai = acc[s["input"]]
                if ai.get("count") != c["frames"]:
                    continue
                mx = (ai.get("max") or [None])[0]
                if mx is None or abs(mx - want_last) > 1e-4:
                    continue
                ok = True
                break
            if ok:
                stats["gltf_clips_verified"] += 1
            else:
                stats["gltf_timeline_mismatch"] += 1


def check_manifest(doc, stats):
    """Every bank name must resolve in the audio manifest."""
    try:
        with open(MANIFEST) as fh:
            sfx = json.load(fh)["sfx"]
    except (OSError, ValueError):
        stats["audio_manifest_missing"] += 1
        return
    for _surface, pair in doc["banks"].items():
        for _gait, refs in pair.items():
            for ref in refs or []:
                if ref not in sfx:
                    stats["bank_unresolved"] += 1


def check_pawn_table(stats):
    """PAWNS must still agree with build_characters.py COMBOS."""
    src = os.path.join(ROOT, "tools", "src", "char_pipeline",
                       "build_characters.py")
    try:
        with open(src) as fh:
            text = fh.read()
    except OSError:
        stats["combos_unreadable"] += 1
        return
    for model_id, package, prefix in PAWNS:
        needle = "'%s'" % model_id
        i = text.find(needle)
        if i < 0:
            stats["combos_mismatch"] += 1
            continue
        row = text[i:text.find("\n", i)]
        if ("'%s'" % package) not in row or ("'%s'" % prefix) not in row:
            stats["combos_mismatch"] += 1


def new_stats():
    return dict(sequences=0, sequences_unlocated=0, step_notifies=0,
                divergent_banks=0, steps_off_timeline=0,
                locomotion_not_two_steps=0,
                steps_outside_locomotion=0, clips=0, clips_without_two_steps=0,
                clips_bad_timeline=0, legacy_clip_missing=0,
                gltf_missing=0, gltf_clip_missing=0, gltf_clips_verified=0,
                gltf_timeline_mismatch=0, audio_manifest_missing=0,
                bank_unresolved=0, combos_unreadable=0, combos_mismatch=0)


FATAL = ("sequences_unlocated", "divergent_banks", "steps_off_timeline",
         "locomotion_not_two_steps", "steps_outside_locomotion",
         "clips_without_two_steps", "clips_bad_timeline",
         "legacy_clip_missing", "gltf_clip_missing", "gltf_timeline_mismatch",
         "bank_unresolved", "combos_mismatch")


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true",
                    help="re-derive and diff against the written JSON")
    args = ap.parse_args(argv)

    stats = new_stats()
    doc = build(stats)
    check_gltf(doc, stats)
    check_manifest(doc, stats)
    check_pawn_table(stats)

    differs = False
    if args.check:
        try:
            with open(OUT) as fh:
                have = json.load(fh)
        except (OSError, ValueError) as exc:
            print("stepnotify.json unreadable: %s" % exc)
            have, differs = None, True
        if have is not None and have != doc:
            differs = True
    else:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w") as fh:
            json.dump(doc, fh, indent=1, sort_keys=True)

    print("pawns:                          %d" % len(doc["pawns"]))
    print("sequences located:              %d (%d not located)"
          % (stats["sequences"], stats["sequences_unlocated"]))
    print("step notifies (Sound-less):     %d" % stats["step_notifies"])
    print("notifies with divergent banks:  %d" % stats["divergent_banks"])
    print("step notifies off the timeline: %d" % stats["steps_off_timeline"])
    print("walk/run without exactly 2:     %d" % stats["locomotion_not_two_steps"])
    print("steps outside walk/run:         %d" % stats["steps_outside_locomotion"])
    print("client clips emitted:           %d" % stats["clips"])
    print("glTF clip timelines verified:   %d (%d mismatched, %d absent)"
          % (stats["gltf_clips_verified"], stats["gltf_timeline_mismatch"],
             stats["gltf_clip_missing"]))
    print("bank names not in manifest:     %d" % stats["bank_unresolved"])
    print("PAWNS vs COMBOS mismatches:     %d" % stats["combos_mismatch"])
    if args.check:
        print("stepnotify.json:                %s"
              % ("DIFFERS from the .ukx" if differs else "matches the .ukx"))
    bad = differs or any(stats[k] for k in FATAL)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
