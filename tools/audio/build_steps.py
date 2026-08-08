#!/usr/bin/env python3
"""build_steps.py - the retail footstep-by-surface data, out of the .unr tiles.

THE SELECTION RULE, DECODED
---------------------------
Interlude does not pick a footstep from a terrain layer or a material name.
It picks it from the ACTOR you are standing on. The decrypted Engine.u carries
the source of the class:

    //=============================================================================
    // StaticMeshActor.
    //=============================================================================
    class StaticMeshActor extends Actor native placeable;
    ...
    //#ifdef __L2 // zodiac
    var(Sound) sound StepSound_1;
    var(Sound) sound StepSound_2;
    var(Sound) sound StepSound_3;
    //#endif

and engine.dll exports exactly the two implementations that consume it:

    ?GetStepSoundData@AActor@@UAEPAVUSound@@XZ
    ?GetStepSoundData@AStaticMeshActor@@UAEPAVUSound@@XZ

-- a virtual on Actor, overridden on StaticMeshActor. Nothing else overrides
it (LineageCreature.dll re-exports only the AActor one). TerrainInfo does not:
its TerrainLayer struct has Texture / AlphaMap / UScale / VScale / UPan / VPan
/ TextureMapAxis / TextureRotation / LayerRotation / TerrainMatrix / KFriction
/ KRestitution / LayerWeightMap and, in the L2 fork, Scale / ToWorld /
ToMaskmap / bUseAlpha. There is no sound field anywhere in it.

So: a step sound comes from the static mesh under your feet, and there are
three alternates per actor so repeated steps do not sound identical -- the
same bank-of-N convention npcgrp uses for damage sounds. Terrain has none.

THE OTHER HALF: WHEN, AND WHAT IF IT IS NOT A MESH
--------------------------------------------------
Engine.u also declares the notify that fires a footstep, and it carries the
whole surface taxonomy:

    class AnimNotify_Sound extends AnimNotify native;
    var() sound Sound;
    var() float Volume;
    var() int   Radius;
    //#ifdef __L2 Hunter
    var() int   Random;
    //#endif
    //#ifdef __L2 zodiac
    var sound DefaultWalkSound[3];
    var sound DefaultRunSound[3];
    var sound GrassWalkSound[3];
    var sound GrassRunSound[3];
    var sound WaterWalkSound[3];
    var sound WaterRunSound[3];
    var sound DefaultActorWalkSound[3];
    var sound DefaultActorRunSound[3];
    //#endif
    enum L2PawnSoundType { LPST_GRASS, LPST_LAND, LPST_WATER, LPST_ACTOR };

So the complete rule is:

  WHEN   an AnimNotify_Sound on the walk/run animation sequence -- the
         footfall frames are authored into the animation, so cadence is not a
         timer and must not be invented as one. NOT YET READ OUT OF THE .ukx.
  WHICH  four surface categories, not fifteen materials: GRASS, LAND, WATER,
         ACTOR. Each has a walk bank and a run bank of three.
  ACTOR  when the surface is a StaticMeshActor, its own StepSound_1..3 is
         used; DefaultActorWalkSound/RunSound is the fallback for a mesh that
         declares none. That per-actor bank is what this tool extracts.

STILL UNDECODED, and deliberately not guessed:
  * Which .ogg fills each of the eight banks. The arrays are `var`, not
    `var()`, so they are populated natively and there are no
    defaultproperties in the script text. The StepSound bank does ship
    default_walk_01..03 / grass_walk_01..03 / water_shalow_01..03 /
    water_deep_01..03 and their _run_ twins, and the name correspondence to
    Default/Grass/Water is exact -- but "exact name correspondence" is an
    inference, and for WATER it does not even pick between shalow and deep.
    Both ChrSound and StepSound carry identical name sets; which package the
    native code loads is likewise unknown.
  * What makes terrain read as GRASS rather than LAND. TerrainLayer has no
    sound field (see above), so it is decided in native code -- plausibly from
    the DecorationLayer grass density, but that is a guess and is recorded as
    one.

There is a THIRD, unused path. Engine.u's PhysicsVolume also carries

    //#ifdef __L2 // zodiac
    var() bool bL2WaterVolume;
    var() bool bL2StepVolume;
    var(StepSound) int StepSoundID;

and engine.dll exports ?GetStepSoundName@FL2GameData@@QAEPBGH@Z (int -> name).
NO ACTOR IN ANY OF THE 100 SHIPPED INTERLUDE TILES SETS EITHER PROPERTY --
this tool counts them and reports zero. The int->name table lives in
engine.dll, which ships packed (30 MB, three wide strings in the whole file),
so it cannot be read statically. Since retail authors zero step volumes the
table is not needed to reproduce Interlude, and it is left undecoded rather
than invented.

WHAT THIS WRITES
----------------
    assets/world/<tile>/steps.json

        {"tile": "17_25",
         "actors": 207,           # StaticMeshActors carrying a bank
         "props": {"14": [0, 1, 2], ...},   # scene.json prop index -> bank
         "names": ["chrsound.stone_gritty_walk_01", ...]}

Prop indices are matched to assets/world/<tile>/scene.json by (mesh,
location): convert.py writes a prop's "position" straight from the actor's
UE Location with no transform, and its "mesh" as "package.Name", so the pair
is an exact join key. The match rate is asserted at 100% -- if it ever is not,
this fails rather than dropping actors.

Sound names are lowercased "package.name", the same key audio manifest.json
uses, so the client resolves them with the lookup it already has.

Usage:
  python3 tools/audio/build_steps.py 17_25 [19_22 ...]
  python3 tools/audio/build_steps.py --all
  python3 tools/audio/build_steps.py --check [tiles]   # re-derive, diff, no write
"""

import argparse
import collections
import json
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tools", "world"))

from l2lib import L2Error, load_package                       # noqa: E402
from l2lib.ue2package import RF_HAS_STACK, read_state_frame    # noqa: E402
from convert import read_props_ordered, prop_objref, prop_vector  # noqa: E402

CLIENT_MAPS = os.path.join(ROOT, "assets", "interlude", "maps")
WORLD = os.path.join(ROOT, "assets", "world")
MANIFEST = os.path.join(ROOT, "assets", "audio", "manifest.json")

PROP_OBJECT = 5
STEP_SLOTS = ("StepSound_1", "StepSound_2", "StepSound_3")
# Position rounding for the join key. convert.py copies the float Location
# verbatim into scene.json and json.dump round-trips a float exactly, so this
# is a formatting guard, not a tolerance.
Q = 3


def _objref_name(pkg, prop):
    if not prop or prop["type"] != PROP_OBJECT:
        return None
    ref = prop_objref(pkg, prop["raw"])
    if not ref or not ref.get("name"):
        return None
    pkgname = ref.get("package")
    return ("%s.%s" % (pkgname, ref["name"])) if pkgname else ref["name"]


def read_actors(tile, stats):
    """-> ([(mesh, poskey, [sound refs])], step_volume_actor_count)."""
    pkg, _ = load_package(os.path.join(CLIENT_MAPS, tile + ".unr"))
    out = []
    stepvols = 0
    for e in pkg.exports:
        cls = pkg.class_name_of(e)
        try:
            r = pkg.body_reader(e)
            if e.object_flags & RF_HAS_STACK:
                read_state_frame(pkg, r)
            props, _end = read_props_ordered(pkg, r.pos)
        except (L2Error, IndexError, ValueError):
            stats["unreadable_actors"] += 1
            continue
        d = dict((p["name"], p) for p in props)

        # the unused volume path -- counted so the claim stays checkable
        if "StepSoundID" in d or "bL2StepVolume" in d:
            stepvols += 1

        if cls != "StaticMeshActor":
            continue
        bank = [n for n in (_objref_name(pkg, d.get(k)) for k in STEP_SLOTS) if n]
        if not bank:
            continue
        mesh = _objref_name(pkg, d.get("StaticMesh"))
        loc = d.get("Location")
        pos = prop_vector(loc["raw"]) if loc and loc["size"] == 12 else [0.0, 0.0, 0.0]
        if mesh is None:
            stats["actors_no_mesh"] += 1
            continue
        out.append((mesh, tuple(round(v, Q) for v in pos), bank))
    return out, stepvols


def build_tile(tile, sfx, stats):
    actors, stepvols = read_actors(tile, stats)
    stats["step_volume_actors"] += stepvols

    with open(os.path.join(WORLD, tile, "scene.json")) as fh:
        scene = json.load(fh)
    index = collections.defaultdict(list)
    for i, p in enumerate(scene["props"]):
        index[(p["mesh"], tuple(round(v, Q) for v in p["position"]))].append(i)

    names, nidx = [], {}

    def intern(ref):
        key = ref.lower()
        if key not in nidx:
            nidx[key] = len(names)
            names.append(key)
        return nidx[key]

    props = {}
    unmatched = 0
    for mesh, pos, bank in actors:
        hits = index.get((mesh, pos))
        if not hits:
            unmatched += 1
            continue
        encoded = [intern(r) for r in bank]
        for i in hits:
            # A repeated (mesh, position) is the same physical prop authored
            # twice; the banks agree wherever it happens. Assert rather than
            # silently keep the last one.
            if str(i) in props and props[str(i)] != encoded:
                stats["conflicting_props"] += 1
            props[str(i)] = encoded

    stats["tiles"] += 1
    stats["actors"] += len(actors)
    stats["matched"] += len(actors) - unmatched
    stats["unmatched"] += unmatched
    for n in names:
        stats["names"].add(n)
        if n not in sfx:
            stats["unresolved"][n] = stats["unresolved"].get(n, 0) + 1

    return {"tile": tile, "actors": len(actors), "props": props, "names": names}


def all_tiles():
    return sorted(d for d in os.listdir(WORLD)
                  if os.path.isdir(os.path.join(WORLD, d))
                  and os.path.exists(os.path.join(CLIENT_MAPS, d + ".unr"))
                  and os.path.exists(os.path.join(WORLD, d, "scene.json")))


def new_stats():
    return {"tiles": 0, "actors": 0, "matched": 0, "unmatched": 0,
            "actors_no_mesh": 0, "unreadable_actors": 0,
            "step_volume_actors": 0, "conflicting_props": 0,
            "names": set(), "unresolved": {}}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("tiles", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--check", action="store_true",
                    help="re-derive and diff against the written steps.json")
    args = ap.parse_args(argv)

    tiles = args.tiles
    if args.all or (not tiles and args.check):
        tiles = all_tiles()
    if not tiles:
        ap.error("give tile names, --all, or --check")

    with open(MANIFEST) as fh:
        sfx = json.load(fh)["sfx"]

    stats = new_stats()
    failures = []
    for tile in tiles:
        try:
            doc = build_tile(tile, sfx, stats)
        except (L2Error, OSError, ValueError) as exc:
            failures.append((tile, str(exc)))
            continue
        path = os.path.join(WORLD, tile, "steps.json")
        if args.check:
            try:
                with open(path) as fh:
                    have = json.load(fh)
            except (OSError, ValueError) as exc:
                failures.append((tile, "steps.json unreadable: %s" % exc))
                continue
            if have != doc:
                failures.append((tile, "steps.json differs from the .unr"))
        else:
            with open(path, "w") as fh:
                json.dump(doc, fh, separators=(",", ":"))

    print("tiles processed:               %d" % stats["tiles"])
    print("StaticMeshActors with a bank:  %d" % stats["actors"])
    print("matched to a scene.json prop:  %d (%d unmatched)"
          % (stats["matched"], stats["unmatched"]))
    print("distinct step sound names:     %d" % len(stats["names"]))
    print("names that do not resolve:     %d %s"
          % (len(stats["unresolved"]), sorted(stats["unresolved"]) or ""))
    print("actors with a StaticMesh ref:  %d missing"
          % stats["actors_no_mesh"])
    print("PhysicsVolume step volumes:    %d  (the unused bL2StepVolume path)"
          % stats["step_volume_actors"])
    print("props with conflicting banks:  %d" % stats["conflicting_props"])
    print("unreadable actor bodies:       %d" % stats["unreadable_actors"])
    print("failures:                      %d" % len(failures))
    for tile, msg in failures:
        print("   %s: %s" % (tile, msg))

    bad = (failures or stats["unmatched"] or stats["unresolved"]
           or stats["conflicting_props"])
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
