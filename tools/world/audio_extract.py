#!/usr/bin/env python3
"""audio_extract.py - retail spatial audio design from the .unr map tiles.

Every map tile carries the game's soundscape as placed actors. For each tile
<tx>_<ty> this reads

    assets/interlude/maps/<tile>.unr           (AmbientSoundObject, MusicVolume,
                                                LevelInfo, Model brushes)
    assets/interlude/system/musicinfo.dat      (nMusicID -> track names)
    assets/audio/manifest.json                 (shipped .ogg inventory)

and writes the SIBLING file

    assets/world/<tile>/audio.json

scene.json is a frozen contract and is never opened or touched here.

Usage:
    python3 tools/world/audio_extract.py 17_25 [19_22 ...]
    python3 tools/world/audio_extract.py --all
    python3 tools/world/audio_extract.py --check [17_25 ...]   (all if omitted)


FORMAT NOTES
------------

1. The state frame.  MusicVolume / LevelInfo / ZoneInfo bodies do not begin
   with properties: they are scripted Actors, so their export ObjectFlags
   carry RF_HasStack (0x02000000) and a UE2 FStateFrame is serialised first
   (layout in l2lib/ue2package.py).  AmbientSoundObject has flags 0x00070001
   -- no RF_HasStack -- which is why it always parsed at +0.  Skipping the
   frame is what pkg.actor_body_reader() does; here we need the ordered,
   typed property list so we call read_state_frame() and hand the position
   to convert.read_props_ordered().

   The oracle is exact byte consumption: after the skip every one of these
   bodies must decode to properties that end precisely on
   serial_offset + serial_size.  --check asserts that for every actor read.

2. What the actors actually hold.  Verified against the class declarations in
   the decrypted client script assets/interlude/system/Engine.u:

       class MusicVolume extends Volume
           var(Music) int  nMusicID;
           var(Music) bool bForcePlayMusic;
           var(Music) bool bLoopMusic;

   -- so a MusicVolume names NO song and has NO radius and NO priority
   field.  It identifies its track by integer id, and its extent is the
   brush (a Volume is a BSP brush), not a sphere.  "radius"/"priority" in
   the output are therefore derived / null, see 4 below.

       // AmbientSoundObject
       enum ASType1 { AST1_Always, AST1_Day, AST1_Night, AST1_Water };
       var(Sound) ASType1 AmbientSoundType;
       var(Sound) int     AmbientRandom;
       var(Sound) sound   AmbientSound;
       var(Sound) float   SoundRadius;
       var(Sound) byte    SoundVolume;
       var(Sound) byte    SoundPitch;   // Sound pitch shift, 64.0=none.

   That trailing comment is the source for the pitch rule: the stored byte
   is a shift where 64 means unity, so pitch = SoundPitch / 64.0.  Nothing
   is defaulted: a property absent from the stream is emitted as null
   rather than guessed from a class default we cannot read.

3. musicinfo.dat (Lineage2Ver413, decrypts through l2lib).  Flat table:

       u32 RecordCount
       RecordCount x { i32 nMusicID, i32 TrackCount,
                       TrackCount x { u32 ByteLength, UTF-16LE bytes } }
       trailing b"\\x0cSafePackage\\x00" footer

   Track names are stored upper/mixed case without an extension
   ("NT_Speaking", "F07_F").  The mapping rule to the shipped files is
   lowercase + ".ogg" -- that resolves 204 of the 205 distinct names in the
   table against assets/audio/manifest.json (the 205th is the empty string).
   One id may list several tracks; the client picks among them, so all of
   them are emitted in "songs" and the first in "song".

4. Coordinates.  Positions are the raw UE Location vector in absolute L2
   world units -- byte-identical to the convention convert.py uses for
   scene.json prop placements (convert.py writes a["location"] straight
   into "position" with no transform).

   A MusicVolume's real extent is its brush box, so both are emitted:
   "bounds" is the truth (brush FBox in world space, computed exactly the
   way convert.read_water_volumes does it: Location + Model bbox - PrePivot)
   and "radius" is the half-diagonal of that box, a derived convenience.
   "priority" is always null -- retail has no such property.
"""

import argparse
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from l2lib import L2Error, Reader, load_package  # noqa: E402
from l2lib.ue2package import (RF_HAS_STACK, decrypt_file_bytes,  # noqa: E402
                              read_properties, read_state_frame)
from convert import (read_props_ordered, prop_objref,  # noqa: E402
                     prop_vector, prop_float)

CLIENT = os.path.join(ROOT, "assets", "interlude")
OUT_ROOT = os.path.join(ROOT, "assets", "world")
MUSICINFO = os.path.join(CLIENT, "system", "musicinfo.dat")
AUDIO_MANIFEST = os.path.join(ROOT, "assets", "audio", "manifest.json")

PROP_BYTE, PROP_INT, PROP_BOOL, PROP_FLOAT, PROP_OBJECT = 1, 2, 3, 4, 5
PROP_STRUCT = 10

SOUND_PITCH_UNITY = 64.0  # Engine.u: "Sound pitch shift, 64.0=none."


# ---------------------------------------------------------------------------
# reference data: musicinfo.dat + the shipped audio manifest
# ---------------------------------------------------------------------------

def load_musicinfo(path=MUSICINFO):
    """-> {nMusicID: [track name, ...]} (see FORMAT NOTES 3)."""
    data = decrypt_file_bytes(open(path, "rb").read(), path)[0]
    pos = [0]

    def u32():
        v = struct.unpack_from("<I", data, pos[0])[0]
        pos[0] += 4
        return v

    def ustr():
        n = u32()
        s = data[pos[0]:pos[0] + n].decode("utf-16le")
        pos[0] += n
        return s

    table = {}
    for _ in range(u32()):
        mid = struct.unpack_from("<i", data, pos[0])[0]
        pos[0] += 4
        table[mid] = [ustr() for _ in range(u32())]
    tail = data[pos[0]:]
    if tail != b"\x0cSafePackage\x00":
        raise L2Error("%s: unexpected %d-byte tail %r" % (path, len(tail), tail))
    return table


def load_manifest(path=AUDIO_MANIFEST):
    with open(path) as f:
        man = json.load(f)
    return man["sfx"], set(man["music"])


def song_file(track, music_files):
    """Track name from musicinfo.dat -> shipped .ogg filename, or None."""
    if not track:
        return None
    fn = track.lower() + ".ogg"
    return fn if fn in music_files else None


# ---------------------------------------------------------------------------
# actor property access
# ---------------------------------------------------------------------------

def actor_props(pkg, export):
    """Ordered typed property list of a map actor, state frame skipped.

    Raises if the stream does not end exactly on the export's serial_size --
    that equality is the only proof we have that the skip was right.
    """
    r = pkg.body_reader(export)
    if export.object_flags & RF_HAS_STACK:
        read_state_frame(pkg, r)
    props, end = read_props_ordered(pkg, r.pos)
    want = export.serial_offset + export.serial_size
    if end != want:
        raise L2Error("%s: %s '%s' properties end at 0x%X, body ends at 0x%X"
                      % (pkg.path, pkg.class_name_of(export),
                         pkg.export_name(export), end, want))
    return props


def by_name(props):
    """Last-wins {name: prop}; map actors never repeat a scalar property."""
    return dict((p["name"], p) for p in props)


def p_int(p):
    return struct.unpack("<i", p["raw"])[0] if p and p["size"] == 4 else None


def p_byte(p):
    return p["raw"][0] if p and p["size"] == 1 else None


def p_vec(p):
    return prop_vector(p["raw"]) if p and p["size"] == 12 else None


# ---------------------------------------------------------------------------
# ambient sounds
# ---------------------------------------------------------------------------

def read_ambient(pkg, sfx, stats):
    """AmbientSoundObject exports -> ambient entries (no state frame)."""
    out = []
    for e in pkg.exports_by_class("AmbientSoundObject"):
        props = by_name(actor_props(pkg, e))
        stats["ambient_actors"] += 1
        snd = props.get("AmbientSound")
        loc = p_vec(props.get("Location"))
        if snd is None or snd["type"] != PROP_OBJECT or loc is None:
            # editor leftovers: an actor placed with no sound assigned. It
            # emits nothing in the client, so it emits nothing here either.
            stats["ambient_no_sound"] += 1
            continue
        ref = prop_objref(pkg, snd["raw"])
        if ref is None or not ref["package"]:
            stats["ambient_no_sound"] += 1
            continue
        name = "%s.%s" % (ref["package"], ref["name"])
        if name.lower() in sfx:
            stats["ambient_resolved"] += 1
        else:
            stats["ambient_unresolved"][name] = \
                stats["ambient_unresolved"].get(name, 0) + 1
        pitch = p_byte(props.get("SoundPitch"))
        radius = props.get("SoundRadius")
        out.append({
            "sound": name,
            "position": loc,
            "radius": prop_float(radius["raw"]) if radius else None,
            "volume": p_byte(props.get("SoundVolume")),
            "type": p_byte(props.get("AmbientSoundType")),
            "random": p_int(props.get("AmbientRandom")),
            "pitch": None if pitch is None else pitch / SOUND_PITCH_UNITY,
        })
    return out


# ---------------------------------------------------------------------------
# music volumes
# ---------------------------------------------------------------------------

def brush_world_box(pkg, props):
    """World-space FBox of a Volume's brush -> (min, max) or None.

    UPrimitive::Serialize writes FBox + FSphere straight after the Model's
    property list; the brush sits at the actor's Location minus PrePivot
    (identical construction to convert.read_water_volumes).
    """
    bref = props.get("Brush")
    loc = p_vec(props.get("Location"))
    if bref is None or bref["type"] != PROP_OBJECT or loc is None:
        return None
    brush = prop_objref(pkg, bref["raw"])
    if brush is None:
        return None
    mexp = next((x for x in pkg.exports
                 if pkg.export_name(x) == brush["name"]), None)
    if mexp is None or mexp.serial_size == 0:
        return None
    r = pkg.body_reader(mexp)
    try:
        read_properties(pkg, r)
        raw = r.bytes(41)  # FBox: Min, Max, u8 IsValid  (+ FSphere, unused)
    except L2Error:
        return None
    if len(raw) < 41 or raw[24] == 0:
        return None
    mn = struct.unpack("<3f", raw[0:12])
    mx = struct.unpack("<3f", raw[12:24])
    pp = p_vec(props.get("PrePivot")) or [0.0, 0.0, 0.0]
    return ([loc[i] + mn[i] - pp[i] for i in range(3)],
            [loc[i] + mx[i] - pp[i] for i in range(3)])


def read_music(pkg, musicinfo, music_files, stats):
    out = []
    for e in pkg.exports_by_class("MusicVolume"):
        props = by_name(actor_props(pkg, e))
        stats["music_actors"] += 1
        mid = p_int(props.get("nMusicID"))
        loc = p_vec(props.get("Location"))
        if mid is None or loc is None:
            stats["music_no_id"] += 1
            continue
        tracks = musicinfo.get(mid)
        if tracks is None:
            stats["music_unknown_id"][mid] = \
                stats["music_unknown_id"].get(mid, 0) + 1
            tracks = []
        songs = []
        for t in tracks:
            stats["music_tracks"] += 1
            fn = song_file(t, music_files)
            if fn is None:
                stats["music_unresolved"][t] = \
                    stats["music_unresolved"].get(t, 0) + 1
            else:
                stats["music_resolved"] += 1
                songs.append(fn)
        if songs:
            stats["music_volumes_resolved"] += 1
        box = brush_world_box(pkg, props)
        radius = None
        if box is not None:
            radius = 0.5 * math.sqrt(sum((box[1][i] - box[0][i]) ** 2
                                         for i in range(3)))
        out.append({
            "song": songs[0] if songs else None,
            "position": loc,
            "radius": radius,
            "priority": None,          # retail MusicVolume has no priority
            "songs": songs,
            "musicId": mid,
            "bounds": None if box is None else {"min": box[0], "max": box[1]},
            "forcePlay": bool(props.get("bForcePlayMusic", {}).get("boolval")),
            "loop": bool(props.get("bLoopMusic", {}).get("boolval")),
        })
    return out


def read_default_song(pkg, music_files, stats):
    """LevelInfo's default track.

    UE2 LevelInfo declares `var(Audio) music Song;`, but no LevelInfo in any
    of the 100 shipped tiles serialises it (nor any nMusicID), so this
    returns None everywhere -- the level-wide default is simply not authored
    in Interlude map data. Kept as a real lookup so a tile that does carry
    one is picked up rather than silently dropped.
    """
    for e in pkg.exports_by_class("LevelInfo"):
        props = by_name(actor_props(pkg, e))
        song = props.get("Song")
        if song is not None and song["type"] == PROP_OBJECT:
            ref = prop_objref(pkg, song["raw"])
            if ref:
                stats["levelinfo_song"] += 1
                return song_file(ref["name"], music_files) or ref["name"]
        mid = p_int(props.get("nMusicID"))
        if mid is not None:
            stats["levelinfo_song"] += 1
            return mid
    return None


# ---------------------------------------------------------------------------
# per-tile driver
# ---------------------------------------------------------------------------

def new_stats():
    return {"tiles": 0, "ambient_actors": 0, "ambient_no_sound": 0,
            "ambient_resolved": 0, "ambient_unresolved": {},
            "music_actors": 0, "music_no_id": 0, "music_tracks": 0,
            "music_resolved": 0, "music_unresolved": {},
            "music_volumes_resolved": 0, "music_unknown_id": {},
            "levelinfo_song": 0}


def build_tile(tile, musicinfo, sfx, music_files, stats):
    path = os.path.join(CLIENT, "maps", tile + ".unr")
    pkg, _ = load_package(path)
    doc = {
        "tile": tile,
        "defaultSong": read_default_song(pkg, music_files, stats),
        "music": read_music(pkg, musicinfo, music_files, stats),
        "ambient": read_ambient(pkg, sfx, stats),
    }
    stats["tiles"] += 1
    return doc


def write_tile(tile, doc):
    out_dir = os.path.join(OUT_ROOT, tile)
    if not os.path.isdir(out_dir):
        raise L2Error("%s: no assets/world/%s directory" % (tile, tile))
    with open(os.path.join(out_dir, "audio.json"), "w") as f:
        json.dump(doc, f, indent=1)


def all_tiles():
    return sorted(d for d in os.listdir(OUT_ROOT)
                  if os.path.isdir(os.path.join(OUT_ROOT, d))
                  and os.path.exists(os.path.join(CLIENT, "maps", d + ".unr")))


def report(stats, unresolved_detail=True):
    amb_emitted = stats["ambient_actors"] - stats["ambient_no_sound"]
    print("tiles processed:            %d" % stats["tiles"])
    print("ambient actors:             %d (%d with no AmbientSound, skipped)"
          % (stats["ambient_actors"], stats["ambient_no_sound"]))
    print("ambient emitters written:   %d" % amb_emitted)
    if amb_emitted:
        print("ambient names resolved:     %d/%d (%.3f%%)"
              % (stats["ambient_resolved"], amb_emitted,
                 100.0 * stats["ambient_resolved"] / amb_emitted))
    print("music volumes:              %d (%d with no nMusicID, skipped)"
          % (stats["music_actors"], stats["music_no_id"]))
    if stats["music_tracks"]:
        print("music tracks resolved:      %d/%d (%.3f%%)"
              % (stats["music_resolved"], stats["music_tracks"],
                 100.0 * stats["music_resolved"] / stats["music_tracks"]))
    mv = stats["music_actors"] - stats["music_no_id"]
    if mv:
        print("music volumes with a song:  %d/%d (%.3f%%)"
              % (stats["music_volumes_resolved"], mv,
                 100.0 * stats["music_volumes_resolved"] / mv))
    print("LevelInfo default songs:    %d" % stats["levelinfo_song"])
    if unresolved_detail:
        for label, d in (("ambient sound", stats["ambient_unresolved"]),
                         ("music track", stats["music_unresolved"]),
                         ("nMusicID not in musicinfo.dat",
                          stats["music_unknown_id"])):
            if d:
                print("unresolved %s (%d distinct):" % (label, len(d)))
                for k, n in sorted(d.items(), key=lambda kv: -kv[1]):
                    print("   %-40s x%d" % (k, n))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("tiles", nargs="*")
    ap.add_argument("--all", action="store_true", help="every tile")
    ap.add_argument("--check", action="store_true",
                    help="re-derive and diff against the written audio.json")
    args = ap.parse_args(argv)

    tiles = args.tiles
    if args.all or (not tiles and args.check):
        tiles = all_tiles()
    if not tiles:
        ap.error("give tile names, --all, or --check")

    musicinfo = load_musicinfo()
    sfx, music_files = load_manifest()
    stats = new_stats()
    failures = []

    for tile in tiles:
        try:
            doc = build_tile(tile, musicinfo, sfx, music_files, stats)
        except (L2Error, OSError, struct.error) as exc:
            failures.append((tile, str(exc)))
            continue
        if args.check:
            path = os.path.join(OUT_ROOT, tile, "audio.json")
            try:
                with open(path) as f:
                    have = json.load(f)
            except (OSError, ValueError) as exc:
                failures.append((tile, "audio.json unreadable: %s" % exc))
                continue
            if have != doc:
                failures.append((tile, "audio.json differs from the .unr"))
        else:
            write_tile(tile, doc)

    report(stats)
    print("failures:                   %d" % len(failures))
    for tile, msg in failures:
        print("   %s: %s" % (tile, msg))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
