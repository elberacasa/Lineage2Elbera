#!/usr/bin/env python3
"""itemId -> weapon mesh, for the client's hand-attachment lookup.

The server names an equipped weapon by item id (the paperdoll arrays in
UserInfo/CharInfo). The weapon model manifest is keyed by mesh object name,
because many item ids share one mesh — every enchant level and most name
variants of a sword are the same geometry. Something has to bridge the two, and
the join lives in `weapongrp.json`.

That file is 2.0 MB and the client needs four fields out of it, so this emits
just those. Mesh and texture names are interned into a shared string table the
same way the audio bindings are: 1,313 weapons draw on far fewer distinct
meshes, so the table is most of the saving.

Output assets/gamedata/weaponmesh.json:

    {"meshes": ["lineageweapons.small_sword_m00_wp", ...],
     "textures": ["lineageweapontex.small_sword_t00_wp", ...],
     "items": {"69": {"m": 12, "t": 12, "h": 1, "w": 1}}}

  m/t  index into meshes/textures    h  handness (1 one-hand, 2 two-hand, ...)
  w    weapon_type

Names are lowercased: weapongrp spells packages inconsistently
("LineageWeapons" vs "LineageWeaponsTex") and the manifest lookup is
case-insensitive, so normalising here keeps the client from having to care.

Usage:
  python3 tools/dat/export_weaponmesh.py
  python3 tools/dat/export_weaponmesh.py --check
"""

import argparse
import json
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
GAMEDATA = os.path.join(ROOT, "assets", "gamedata")
SRC = os.path.join(GAMEDATA, "weapongrp.json")
OUT = os.path.join(GAMEDATA, "weaponmesh.json")


def build():
    with open(SRC) as fh:
        records = json.load(fh)

    meshes, mesh_ix = [], {}
    textures, tex_ix = [], {}

    def intern(value, table, index):
        if not value:
            return None
        key = value.lower()
        if key not in index:
            index[key] = len(table)
            table.append(key)
        return index[key]

    items = {}
    for rec in records:
        # `mesh` is a list because a weapon can be built from several parts;
        # the first entry is the weapon body and the only one that attaches to
        # the hand bone. Extra parts are ignored deliberately, not missed.
        mesh_list = rec.get("mesh") or []
        mesh = mesh_list[0] if mesh_list else None
        if not mesh:
            continue                      # shields and a few records carry none
        tex_list = rec.get("texture") or []
        entry = {"m": intern(mesh, meshes, mesh_ix)}
        tex = intern(tex_list[0] if tex_list else None, textures, tex_ix)
        if tex is not None:
            entry["t"] = tex
        if rec.get("handness"):
            entry["h"] = rec["handness"]
        if rec.get("weapon_type"):
            entry["w"] = rec["weapon_type"]
        items[str(rec["object_id"])] = entry

    return {"meshes": meshes, "textures": textures, "items": items}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(SRC):
        print("FAIL: %s missing — run the ElberaDat pipeline first" % SRC)
        return 1

    data = build()
    if not data["items"]:
        print("FAIL: no weapons resolved — weapongrp.json shape changed?")
        return 1

    if args.check:
        if not os.path.exists(OUT):
            print("FAIL: %s missing" % OUT)
            return 1
        with open(OUT) as fh:
            have = json.load(fh)
        if have != data:
            print("FAIL: %s is stale" % OUT)
            return 1
        print("OK: %d weapons, %d distinct meshes"
              % (len(data["items"]), len(data["meshes"])))
        return 0

    with open(OUT, "w") as fh:
        json.dump(data, fh, separators=(",", ":"), sort_keys=True)
    print("wrote %s: %d weapons, %d distinct meshes, %d textures (%.1f KB)"
          % (OUT, len(data["items"]), len(data["meshes"]), len(data["textures"]),
             os.path.getsize(OUT) / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
