#!/usr/bin/env python3
"""Export per-skill weapon requirements + target routing for the client.

The retail client grays out (and refuses to cast) a skill whose weapon
condition does not match the equipped weapon — Power Strike wants a
sword/blunt, Mortal Blow a dagger, Double Shot a bow. That condition is NOT
in skillgrp.dat: its 17 decoded fields carry no weapon mask (cast_style 3
covers BOTH Power Strike/sword and Mortal Blow/dagger, so it cannot be one)
and there is no target-type field either (cast_range == -1 correlates with
SELF but 47 SELF skills have a real range and 83 ONE-target skills have -1).

The condition lives server-side, exactly like the operate types already
exported by export_skilltypes.py:

  server/.../data/xml/skills/*.xml
    <set name="weaponsAllowed" val="SWORD,BLUNT,BIGBLUNT,BIGSWORD" />
    <set name="target" val="SELF|ONE|AURA|..." />

aCis semantics (L2Skill.java:309-342 parse, :1048-1070 check):
  * weaponsAllowed absent            -> any weapon is fine
  * otherwise (weapon | shield) must intersect the name list — a shield in
    the left hand satisfies a "SHIELD" requirement (mask OR'd together)

The equipped item's type comes from the server's own item XMLs:

  server/.../data/xml/items/*.xml
    <item id=".." type="Weapon"> <set name="weapon_type" val="SWORD"/>
    <item id=".." type="Armor">  <set name="bodypart" val="lhand"/>  (shield)

Per-item export beats decoding weapongrp.dat's weapon_type enum: the client
enum conflates what the server distinguishes (type 1 = SWORD *and* BIGSWORD,
type 8 = DUAL *and* BIGSWORD, fist weapons scattered across types 0/5).
A field-level decode of weapongrp (weapon_type + body_part + mesh count)
reproduces the server value for only 1153/1184 shared items (97.4% — hero
and shadow weapons break the body_part heuristic, fist weapons the type
heuristic). See docs/dat-format-notes.md §22 for the decode table.

Outputs:
  assets/gamedata/skillweapons.json  {weapons: {skillId: [names]}, targets: {skillId: name}}
  assets/gamedata/itemtypes.json     {weapon: {itemId: name}, shield: {itemId: 1}}

Usage:
  python3 tools/dat/export_skillweapons.py [--check]
"""

import argparse
import collections
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_SKILLS = os.path.join(REPO,
                          "server/aCis_gameserver/build/dist/gameserver/data/xml/skills")
SRC_ITEMS = os.path.join(REPO,
                         "server/aCis_gameserver/build/dist/gameserver/data/xml/items")
OUT_SKILLS = os.path.join(REPO, "assets/gamedata/skillweapons.json")
OUT_ITEMS = os.path.join(REPO, "assets/gamedata/itemtypes.json")

SKILL = re.compile(r'<skill\s+id="(\d+)"')
WEAPONS = re.compile(r'<set\s+name="weaponsAllowed"\s+val="([^"]+)"')
TARGET = re.compile(r'<set\s+name="target"\s+val="([A-Z0-9_]+)"')
ITEM = re.compile(r'<item\s+id="(\d+)"\s+type="(\w+)"')
WTYPE = re.compile(r'<set\s+name="weapon_type"\s+val="([A-Z0-9_]+)"')
BODYPART = re.compile(r'<set\s+name="bodypart"\s+val="(\w+)"')

# aCis enums/items/WeaponType.java declaration order (mask = 1 << ordinal)
WEAPON_TYPES = ["NONE", "SWORD", "BLUNT", "DAGGER", "BOW", "POLE", "ETC",
                "FIST", "DUAL", "DUALFIST", "BIGSWORD", "FISHINGROD",
                "BIGBLUNT", "PET"]


def parse_skills():
    """skillId -> (weaponsAllowed names, target name), per <skill> block."""
    weapons, targets = {}, {}
    for fn in sorted(os.listdir(SRC_SKILLS)):
        if not fn.endswith(".xml"):
            continue
        text = open(os.path.join(SRC_SKILLS, fn),
                    encoding="utf-8", errors="ignore").read()
        parts = SKILL.split(text)
        for i in range(1, len(parts) - 1, 2):
            sid, body = int(parts[i]), parts[i + 1]
            m = WEAPONS.search(body)
            if m:
                names = [n.strip() for n in m.group(1).split(",") if n.strip()]
                weapons[sid] = names
            m = TARGET.search(body)
            if m:
                targets[sid] = m.group(1)
    return weapons, targets


def parse_items():
    """itemId -> weapon type name; shields = Armor items in the left hand."""
    weapon, shield = {}, {}
    for fn in sorted(os.listdir(SRC_ITEMS)):
        if not fn.endswith(".xml"):
            continue
        text = open(os.path.join(SRC_ITEMS, fn),
                    encoding="utf-8", errors="ignore").read()
        parts = ITEM.split(text)
        for i in range(1, len(parts) - 2, 3):
            iid, typ, body = int(parts[i]), parts[i + 1], parts[i + 2]
            if typ == "Weapon":
                m = WTYPE.search(body)
                if m:
                    weapon[iid] = m.group(1)
            elif typ == "Armor":
                bp = BODYPART.search(body)
                if bp and bp.group(1) == "lhand":
                    shield[iid] = 1
    return weapon, shield


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    for src in (SRC_SKILLS, SRC_ITEMS):
        if not os.path.isdir(src):
            sys.exit(f"missing {src} — is the datapack built?")

    weapons, targets = parse_skills()
    weapon_items, shields = parse_items()

    # sanity: known anchors (retail-observable requirements)
    assert weapons.get(3) == ["SWORD", "BLUNT", "BIGBLUNT", "BIGSWORD"], \
        f"Power Strike parse broke: {weapons.get(3)}"
    assert "DAGGER" in weapons.get(16, []), "Mortal Blow must require DAGGER"
    assert weapons.get(19) == ["BOW"], f"Double Shot parse broke: {weapons.get(19)}"
    assert targets.get(1216) == "SELF", "Self Heal must target SELF"
    assert weapon_items.get(2369) == "SWORD", "Squire's Sword must be SWORD"
    assert weapon_items.get(10) == "DAGGER", "Dagger must be DAGGER"
    assert 18 in shields, "Leather Shield must be a shield"
    unknown = {n for names in weapons.values() for n in names
               if n not in WEAPON_TYPES and n != "SHIELD"}
    counts = collections.Counter(weapon_items.values())

    print(f"skill weapons {len(weapons)}   targets {len(targets)}")
    print(f"item weapons  {len(weapon_items)}   shields {len(shields)}")
    print(f"  types {dict(counts)}")
    ok = (len(weapons) > 50 and len(targets) > 2000
          and len(weapon_items) > 1000 and len(shields) > 50 and not unknown)
    if unknown:
        print("  UNKNOWN type names:", sorted(unknown))
    if args.check:
        print("CHECK", "PASS" if ok else "FAIL")
        return 0 if ok else 1
    if not ok:
        sys.exit("refusing to write: the parse looks incomplete")

    with open(OUT_SKILLS, "w") as f:
        json.dump({"source": "aCis data/xml/skills (weaponsAllowed/target)",
                   "weapons": {str(k): v for k, v in sorted(weapons.items())},
                   "targets": {str(k): v for k, v in sorted(targets.items())}}, f)
    print(f"wrote         {os.path.relpath(OUT_SKILLS, REPO)}")
    with open(OUT_ITEMS, "w") as f:
        json.dump({"source": "aCis data/xml/items (weapon_type / lhand armor)",
                   "weapon": {str(k): v for k, v in sorted(weapon_items.items())},
                   "shield": {str(k): v for k, v in sorted(shields.items())}}, f)
    print(f"wrote         {os.path.relpath(OUT_ITEMS, REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
