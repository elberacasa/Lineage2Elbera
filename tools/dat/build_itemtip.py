#!/usr/bin/env python3
"""Build assets/gamedata/itemtip.json -- the per-item fields the retail item
tooltip reads, and nothing else.

    python3 tools/dat/build_itemtip.py           write the table
    python3 tools/dat/build_itemtip.py --check   re-derive, exit 1 on drift

WHAT THIS IS
------------
`assets/gamedata/itemtooltip.json` (tools/ui/mine_itemtooltip.py) says WHICH
fields the tooltip shows and in what order. This says WHAT THE VALUES ARE for
each of the 9,238 items, for the fields the client owns.

`ReturnTooltip_NTT_ITEM` reads exactly these members of ItemInfo
(NWindow/UIEventManager.uc:684). Split by who owns them:

  CLIENT TABLES (this file)   weapongrp / armorgrp / etcitemgrp / ItemName-e
    Weight, CrystalType, WeaponType, PhysicalDamage, MagicalDamage,
    AttackSpeed, SoulshotCount, SpiritshotCount, MpConsume, ShieldDefense,
    ShieldDefenseRate, AvoidModify, PhysicalDefense, MagicalDefense, MpBonus,
    ArmorType, ItemSubType (etcitem_type), ConsumeType (stackable),
    Durability, Name, AdditionalName, Description, and the three set-item
    lists.

  SERVER, per instance (the live inventory packet, NOT here)
    ItemType (ItemList type2), SlotBitType (ItemList bodyPart), ItemNum
    (count), Enchanted (enchant), Price, Reserved.

  SERVER, per instance, NOT YET BRIDGED -- documented gap
    CurrentDurability (ItemList `mana left`) and RefineryOp1/RefineryOp2
    (ItemList `augmentation id`). gateway/src/gameclient.js parseItemEntry
    reads both fields off the wire and discards them, so the shadow-item
    countdown and the augmentation block cannot be drawn. The gateway is
    outside this change's lane; see the report.

WHY NOT REUSE itemmeta.json
---------------------------
itemmeta.json carries name/icon/type/grade for the inventory GRID. It has no
stats at all, and its `type` is the source TABLE (weapon/armor/etc), which is
not the client's EItemType -- shields live in weapongrp but the tooltip draws
them under ITEM_ARMOR. Overloading it would have quietly mixed the two.
"""

import argparse
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
GAMEDATA = os.path.join(ROOT, "assets/gamedata")
OUT = os.path.join(GAMEDATA, "itemtip.json")


def load(name):
    with open(os.path.join(GAMEDATA, name)) as f:
        return json.load(f)


def nz(rec, key):
    """A grp field, dropped when zero -- the JSON is 9,238 rows wide."""
    v = rec.get(key, 0)
    return v if v else None


def build():
    weapon = {r["object_id"]: r for r in load("weapongrp.json")}
    armor = {r["object_id"]: r for r in load("armorgrp.json")}
    etc = {r["object_id"]: r for r in load("etcitemgrp.json")}
    names = {r["id"]: r for r in load("itemname.json")}

    dup = (set(weapon) & set(armor)) | (set(weapon) & set(etc)) | (set(armor) & set(etc))
    if dup:
        raise SystemExit(f"an item id is in two grp tables: {sorted(dup)[:10]}")

    out = {}
    for iid in sorted(set(weapon) | set(armor) | set(etc)):
        n = names.get(iid, {})
        e = {}

        # --- fields every category shows -------------------------------
        if iid in weapon:
            g, tbl = weapon[iid], "weapon"
        elif iid in armor:
            g, tbl = armor[iid], "armor"
        else:
            g, tbl = etc[iid], "etc"
        e["g"] = tbl                              # which grp table it came from
        e["w"] = g["weight"]                      # Item.Weight
        e["ct"] = g["crystal_type"]               # Item.CrystalType (grade symbol)
        # Item.Durability. etcitemgrp stores "no limit" as 0xFFFFFFFF where the
        # other two store -1; normalise to -1 so the tooltip's
        # `Durability > 0` guard behaves identically for all three.
        dur = g["durability"]
        e["dur"] = -1 if dur in (-1, 0xFFFFFFFF) else dur

        if tbl == "weapon":
            # weapongrp holds SHIELDS too (weapon_type 0, shield_pdef set);
            # the tooltip routes them by the server's type2 + SlotBitType,
            # not by the table they live in.
            for k, src in (("wt", "weapon_type"), ("pat", "patt"), ("mat", "matt"),
                           ("spd", "speed"), ("ss", "soulshot_count"),
                           ("sps", "spiritshot_count"), ("mp", "mp_consume"),
                           ("sdef", "shield_pdef"), ("srate", "shield_rate"),
                           ("avo", "avoid_mod")):
                v = nz(g, src)
                if v is not None:
                    e[k] = v
        elif tbl == "armor":
            for k, src in (("at", "armor_type"), ("pdef", "pdef"),
                           ("mdef", "mdef"), ("mpb", "mpbonus"),
                           ("avo", "avoid_mod")):
                v = nz(g, src)
                if v is not None:
                    e[k] = v
        else:
            for k, src in (("st", "etcitem_type"), ("cons", "stackable")):
                v = nz(g, src)
                if v is not None:
                    e[k] = v

        # --- ItemName-e.dat ---------------------------------------------
        if n.get("additional_name"):
            e["an"] = n["additional_name"]
        if n.get("description"):
            e["d"] = n["description"]
        # set items: TOOLTIP_SETITEM_MAX is 3, and ItemName-e carries one
        # id list + one effect description per item plus the enchant effect.
        if n.get("set_ids"):
            e["sid"] = [int(x) for x in str(n["set_ids"]).replace(";", ",").split(",")
                        if x.strip().isdigit()]
        if n.get("set_bonus_desc"):
            e["sd"] = n["set_bonus_desc"]
        if n.get("set_enchant_effect"):
            e["se"] = n["set_enchant_effect"]
        if n.get("set_extra_desc"):
            e["sxd"] = n["set_extra_desc"]
        if n.get("set_extra_id"):
            e["sxid"] = [int(x) for x in str(n["set_extra_id"]).replace(";", ",").split(",")
                         if x.strip().isdigit()]
        out[str(iid)] = e
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    doc = build()

    if a.check:
        if not os.path.exists(OUT):
            print(f"FAIL {OUT} missing")
            return 1
        with open(OUT) as f:
            old = json.load(f)
        if json.dumps(old, sort_keys=True) != json.dumps(doc, sort_keys=True):
            print(f"FAIL {OUT} differs from a fresh build")
            return 1
        print(f"OK   {OUT} matches a fresh build ({len(doc)} items)")
        return 0

    with open(OUT, "w") as f:
        json.dump(doc, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")
    print(f"wrote {OUT}  {len(doc)} items  {os.path.getsize(OUT) // 1024} KiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
