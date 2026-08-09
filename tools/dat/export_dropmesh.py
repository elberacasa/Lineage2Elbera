#!/usr/bin/env python3
"""itemId -> the mesh the client drops on the ground.

WHY THIS EXISTS
---------------
The port drew every ground drop as an octahedron. It was written up as
"neither npcgrp nor etcitemgrp carries a ground-drop mesh, so the marker is
authored" (editor/world/js/entities.js, before 2026-08). That is false, and
this tool is the disproof: **all three** item tables carry a complete drop
description, and they have been decoded and sitting in assets/gamedata since
the .dat extraction landed.

    weapongrp.dat   1,313 records   drop_mesh drop_texture drop_radius
    armorgrp.dat    1,014 records   drop_height drop_type drop_anim_type
    etcitemgrp.dat  6,911 records   drop_sound

Adena (object_id 57) says `DropItems.coin_m00` + `DropItemsTex.coin_t00`,
drop_radius 4, drop_height 1, drop_anim_type 5. A quiver says
`dropitems.drop_quiver_m00`. A sword says its OWN `LineageWeapons.<mesh>` —
weapons drop as the weapon, everything else drops as a `dropitems.*` prop.

WHERE THE MESHES ARE
--------------------
Two packages, and BOTH ship with the client:

    animations/LineageWeapons.ukx    417 SkeletalMesh, 180 already built to
                                     glTF by tools/src/char_pipeline/build_weapons.py
    animations/DropItems.ukx         415 SkeletalMesh, NONE built yet
                                     (systextures/DropItemsTex.utx IS already
                                     extracted: 240 PNGs under
                                     assets/library/DropItemsTex/)

So the weapon half needs no new pipeline at all — the geometry is on disk and
this table is the join that was missing. The DropItems half does need one, and
`--check` prints exactly how much is blocked and why (see DOCUMENTED GAP).

DOCUMENTED GAP — why DropItems.ukx is not built here
----------------------------------------------------
371 of the 373 referenced DropItems meshes carry a NON-IDENTITY ULodMesh
instance transform, e.g. `coin_m00` = MeshScale (3,3,3), MeshOrigin
(0,0,0.7), RotOrigin (0,49152,0). build_weapons.py deliberately REFUSES a
non-identity mesh rather than silently dropping the transform, and the
correct application order is a separate decode
(tools/src/UEViewer/MeshInstance/SkelMeshInstance.cpp:192-198 —
RotatorToAxis(RotOrigin) then per-axis MeshScale then
axis.UnTransformVector(-MeshOrigin)). Emitting them without that decode
would put every dropped item at the wrong size, height and yaw. That is a
build, not a guess, and it is left for one.

WHAT IS NOT DECODED
-------------------
`drop_type` and `drop_anim_type` are exported raw. Their enums live only in
the Themida-packed Engine.dll (see editor/world/js/nameplates.js for the
entropy measurement), so this tool passes the integers through and names no
behaviour for them.

Output assets/gamedata/dropmesh.json:

    {"meshes":   ["dropitems.coin_m00", ...],       # interned, lowercased
     "textures": ["dropitemstex.coin_t00", ...],
     "sounds":   ["itemsound.itemdrop_adena", ...],
     "items": {"57": {"m": [0], "t": [0, 1], "r": 4, "h": 1, "dt": 0, "at": 5,
                      "s": 0}}}

      m   indices into meshes          r   drop_radius (L2 units)
          (one per hand: a dual-wield
           weapon names two)
      t   indices into textures        h   drop_height (L2 units)
      s   index into sounds            dt  drop_type      (raw)
                                       at  drop_anim_type (raw)

Usage:
  python3 tools/dat/export_dropmesh.py
  python3 tools/dat/export_dropmesh.py --check
"""

import argparse
import json
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
GAMEDATA = os.path.join(ROOT, "assets", "gamedata")
SOURCES = ("weapongrp.json", "armorgrp.json", "etcitemgrp.json")
OUT = os.path.join(GAMEDATA, "dropmesh.json")
WEAPON_MANIFEST = os.path.join(ROOT, "editor/characters/weapons/manifest.json")

# Every table spells its packages differently -- "DropItems", "dropitems",
# "dropItems", "Dropitems" all occur, and so do "LineageWeapons" /
# "lineageweapons". The client manifest lookup is case-insensitive, so names
# are interned lowercased exactly as tools/dat/export_weaponmesh.py does.
WEAPON_PKG = "lineageweapons"
DROP_PKG = "dropitems"
# weapongrp `handness`: 3 dual sword, 7 dual fist -- the two values that make a
# record name two meshes. Same field build_weapons.py passes through unchanged.
DUAL_WIELD = (3, 7)


def _list(value):
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    return [v for v in value if v]


def build():
    meshes, mesh_ix = [], {}
    textures, tex_ix = [], {}
    sounds, snd_ix = [], {}

    def intern(value, table, index):
        key = value.lower()
        if key not in index:
            index[key] = len(table)
            table.append(key)
        return index[key]

    items = {}
    stats = {"records": 0, "no_mesh": 0, "weapon_pkg": 0, "drop_pkg": 0,
             "other_pkg": 0}
    for fn in SOURCES:
        with open(os.path.join(GAMEDATA, fn)) as fh:
            for rec in json.load(fh):
                stats["records"] += 1
                mesh_names = _list(rec.get("drop_mesh"))
                if not mesh_names:
                    stats["no_mesh"] += 1
                    continue
                # drop_mesh is a LIST, and 210 records really do fill more than
                # one slot -- every one of them a DUAL-WIELD weapon (handness 3
                # dual sword, 7 dual fist), which names one mesh per hand, and
                # 97 of those name two DIFFERENT blades (item 1299 = sword of
                # delusion + sword of magic). Gate 1 asserts exactly that, so
                # the whole list is kept and the client is the one that decides
                # it draws the first. Collapsing to [0] here would have thrown
                # the second blade away silently.
                pkg = mesh_names[0].split(".", 1)[0].lower()
                if pkg == WEAPON_PKG:
                    stats["weapon_pkg"] += 1
                elif pkg == DROP_PKG:
                    stats["drop_pkg"] += 1
                else:
                    stats["other_pkg"] += 1
                entry = {
                    "m": [intern(n, meshes, mesh_ix) for n in mesh_names],
                    "t": [intern(t, textures, tex_ix)
                          for t in _list(rec.get("drop_texture"))],
                    "r": rec.get("drop_radius", 0),
                    "h": rec.get("drop_height", 0),
                    "dt": rec.get("drop_type", 0),
                    "at": rec.get("drop_anim_type", 0),
                }
                snd = rec.get("drop_sound") or ""
                if snd:
                    entry["s"] = intern(snd, sounds, snd_ix)
                items[str(rec["object_id"])] = entry
    return {"meshes": meshes, "textures": textures, "sounds": sounds,
            "items": items}, stats


def built_weapon_meshes():
    """Mesh ids the weapon pipeline has already shipped as glTF."""
    if not os.path.isfile(WEAPON_MANIFEST):
        return set()
    with open(WEAPON_MANIFEST) as fh:
        return {m["id"].lower() for m in json.load(fh)["models"]}


def coverage(doc):
    """How many item ids can render a REAL mesh right now, and what blocks
    the rest. This is the number the client's fallback has to justify."""
    have = built_weapon_meshes()
    ready = blocked_weapon = blocked_drop = other = 0
    for entry in doc["items"].values():
        name = doc["meshes"][entry["m"][0]]
        pkg, obj = name.split(".", 1)
        if pkg == WEAPON_PKG:
            if obj in have:
                ready += 1
            else:
                blocked_weapon += 1
        elif pkg == DROP_PKG:
            blocked_drop += 1
        else:
            other += 1
    return {"ready": ready, "weapon_mesh_not_built": blocked_weapon,
            "dropitems_pkg_not_built": blocked_drop, "other_package": other}


def check(doc, stats):
    """Re-derive everything and fail on drift. Gates:
       0  every source table is present and parses
       1  the drop_mesh arrays really are single-valued
       2  the interned tables round-trip to the source strings
       3  coverage has not shrunk below what the client is coded against
    """
    fails = []

    # gate 1: a multi-valued drop_mesh means dual wield and nothing else.
    # handness 3 = dual sword, 7 = dual fist (weapongrp's own field, the same
    # one build_weapons.py passes through). A multi-mesh record with any other
    # handness would mean the second slot carries something this exporter has
    # not understood.
    stray = []
    for fn in SOURCES:
        with open(os.path.join(GAMEDATA, fn)) as fh:
            for rec in json.load(fh):
                if len(_list(rec.get("drop_mesh"))) > 1 \
                        and rec.get("handness") not in DUAL_WIELD:
                    stray.append((fn, rec["object_id"], rec.get("handness")))
    if stray:
        fails.append("multi-valued drop_mesh outside dual wield for %d records, "
                     "e.g. %s" % (len(stray), stray[:3]))

    # gate 2
    for fn in SOURCES:
        with open(os.path.join(GAMEDATA, fn)) as fh:
            for rec in json.load(fh):
                names = _list(rec.get("drop_mesh"))
                if not names:
                    continue
                e = doc["items"].get(str(rec["object_id"]))
                if not e:
                    fails.append("item %s missing from the table" % rec["object_id"])
                    break
                if [doc["meshes"][i] for i in e["m"]] != [n.lower() for n in names]:
                    fails.append("item %s mesh %r != %r"
                                 % (rec["object_id"],
                                    [doc["meshes"][i] for i in e["m"]],
                                    [n.lower() for n in names]))
                    break

    # gate 3
    cov = coverage(doc)
    if cov["ready"] < READY_FLOOR:
        fails.append("only %d item ids can render a real drop mesh "
                     "(floor %d)" % (cov["ready"], READY_FLOOR))
    return fails, cov


# MEASURED, and a floor rather than a target: the number of item ids whose
# drop_mesh names a LineageWeapons object that build_weapons.py has already
# shipped as glTF. Recomputed on every run by coverage() from
# editor/characters/weapons/manifest.json crossed with the three .dat tables,
# so this literal only pins where the ratchet sits -- it fails if that manifest
# ever loses models, and is raised when the DropItems build lands.
READY_FLOOR = 441


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    for fn in SOURCES:
        if not os.path.isfile(os.path.join(GAMEDATA, fn)):
            sys.exit("missing %s — run tools/dat/extract_gamedata.py" % fn)

    doc, stats = build()
    print("records %(records)d   without a drop mesh %(no_mesh)d" % stats)
    print("  LineageWeapons %(weapon_pkg)d   DropItems %(drop_pkg)d   "
          "other %(other_pkg)d" % stats)
    print("interned: %d meshes, %d textures, %d sounds; %d item ids"
          % (len(doc["meshes"]), len(doc["textures"]), len(doc["sounds"]),
             len(doc["items"])))

    if args.check:
        if not os.path.isfile(OUT):
            print("MISSING %s" % OUT)
            print("CHECK FAIL")
            return 1
        with open(OUT) as fh:
            shipped = json.load(fh)
        fails, cov = check(doc, stats)
        if shipped != doc:
            fails.append("%s is stale — re-run without --check" % OUT)
        print("coverage: %s" % cov)
        for f in fails:
            print("  " + f)
        print("CHECK", "FAIL" if fails else "PASS")
        return 1 if fails else 0

    with open(OUT, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"), sort_keys=True)
    # AUTHORED only in the sense that a KiB is 1024 bytes; this is a log line.
    kib = os.path.getsize(OUT) / 1024
    print("wrote %s (%.0f KB)  coverage %s"
          % (os.path.relpath(OUT, ROOT), kib, coverage(doc)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
