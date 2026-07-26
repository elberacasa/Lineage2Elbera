#!/usr/bin/env python3
"""Seed a test character with levels, skills and gear — for UI testing.

The browser client's windows are only meaningful with a populated character:
an EXP bar needs a level, the skill window needs skills, the inventory needs
items of several types, and the status window needs real HP/MP/CP.

Everything written here comes from the SERVER'S OWN DATA, never invented:

  level -> exp      data/xml/playerLevels.xml   (requiredExpToLevelUp)
  skills            data/xml/classes/<class>.xml (<skill id lvl minLvl>)
  item ids          validated against assets/gamedata/itemname.json

Two safety rules, both learned from how aCis works:

  1. THE CHARACTER MUST BE OFFLINE. aCis holds the character in memory and
     writes it back on logout, so edits made while online are silently
     overwritten. This script refuses to run against an online character.

  2. NEW ITEMS NEED A GAMESERVER RESTART. Item rows need a unique object_id.
     IdFactory learns which ids are taken by scanning the tables AT STARTUP,
     so ids inserted underneath a running server are not registered and could
     later be handed out twice. This script allocates above the current
     maximum and tells you to restart.

Usage:
  python3 tools/dev/seed_test_char.py W4b2ab13b8ff              # dry run
  python3 tools/dev/seed_test_char.py W4b2ab13b8ff --apply
  python3 tools/dev/seed_test_char.py W4b2ab13b8ff --level 40 --gm --apply
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(REPO, "server/aCis_gameserver/build/dist/gameserver/data/xml")
ITEMNAMES = os.path.join(REPO, "assets/gamedata/itemname.json")
BACKUPS = os.path.join(REPO, "server/seed-backups")
DB = ["-u", "l2j", "-pl2jpass", "l2jdb"]

# A deliberately broad kit: several item TYPES so the inventory's tabs,
# weight bar, adena row and stack counts all have something to show.
# Every id is validated against the decoded item table before use.
KIT = [
    (57, 10_000_000),   # Adena
    (2, 1),             # Long Sword
    (13, 1),            # Short Bow
    (2369, 1),          # Squire's Sword
    (23, 1),            # Wooden Breastplate
    (43, 1),            # Wooden Helmet
    (709, 1),           # Leather Shirt
    (713, 1),           # Leather Pants
    (727, 100),         # Healing Potion
    (1835, 5000),       # Soulshot: No Grade
    (736, 20),          # Scroll of Escape
]


def sql(query, tabular=False):
    args = ["mariadb"] + DB + (["-e", query] if tabular else ["-N", "-B", "-e", query])
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"mariadb failed: {r.stderr.strip()}")
    return r.stdout.strip()


def exp_for_level(level):
    root = ET.parse(os.path.join(DATA, "playerLevels.xml")).getroot()
    for pl in root.iter("playerLevel"):
        if int(pl.get("level")) == level:
            return int(pl.get("requiredExpToLevelUp"))
    sys.exit(f"level {level} not found in playerLevels.xml")


def class_file_for(classid):
    """Map a classid to its class XML by reading each file's declared id."""
    d = os.path.join(DATA, "classes")
    for f in sorted(os.listdir(d)):
        if not f.endswith(".xml"):
            continue
        head = open(os.path.join(d, f), encoding="utf-8", errors="ignore").read(4000)
        m = re.search(r'<set\s+id="(\d+)"', head)
        if m and int(m.group(1)) == classid:
            return os.path.join(d, f)
    return None


def skills_up_to(class_path, level):
    """Highest learnable level of each skill available at or below `level`."""
    root = ET.parse(class_path).getroot()
    best = {}
    for sk in root.iter("skill"):
        min_lvl = int(sk.get("minLvl", 1))
        if min_lvl > level:
            continue
        sid, slvl = int(sk.get("id")), int(sk.get("lvl", 1))
        if slvl > best.get(sid, 0):
            best[sid] = slvl
    return best


def item_names():
    raw = json.load(open(ITEMNAMES))
    out = {}
    if isinstance(raw, list):
        for e in raw:
            if e.get("id") is not None:
                out[int(e["id"])] = (e.get("name") or "").strip()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("char_name")
    ap.add_argument("--level", type=int, default=40)
    ap.add_argument("--gm", action="store_true",
                    help="also set accesslevel 7, enabling //set //skill //give")
    ap.add_argument("--apply", action="store_true", help="write (default is a dry run)")
    args = ap.parse_args()

    row = sql(f"SELECT obj_Id,level,classid,online,accesslevel FROM characters "
              f"WHERE char_name='{args.char_name}'")
    if not row:
        sys.exit(f"no character named {args.char_name}")
    obj_id, cur_level, classid, online, access = [int(x) for x in row.split("\t")]

    print(f"character   {args.char_name}  obj_Id={obj_id}  "
          f"level {cur_level} -> {args.level}  classid={classid}")

    if online:
        sys.exit("REFUSING: character is online. aCis writes it back from memory "
                 "on logout and would overwrite these edits.\n"
                 "  Untick 'Online' in the browser, then re-run.")

    cls = class_file_for(classid)
    if not cls:
        sys.exit(f"no class XML declares id={classid}")
    skills = skills_up_to(cls, args.level)
    exp = exp_for_level(args.level)
    names = item_names()

    bad = [i for i, _ in KIT if i not in names]
    if bad:
        sys.exit(f"unverified item ids (not in itemname.json): {bad}")

    print(f"class file  {os.path.basename(cls)}")
    print(f"exp         {exp:,}  (playerLevels.xml)")
    print(f"skills      {len(skills)} learnable at level {args.level}")
    print(f"items       {len(KIT)}:")
    for i, c in KIT:
        print(f"              {i:>5} x{c:<10} {names[i]}")
    if args.gm:
        print(f"accesslevel {access} -> 7 (Admin: //set //skill //give)")

    base = int(sql("SELECT MAX(object_id) FROM items") or 0)
    top = int(sql("SELECT MAX(obj_Id) FROM characters") or 0)
    next_id = max(base, top) + 1000     # gap above everything currently in use
    print(f"object ids  {next_id}..{next_id + len(KIT) - 1} "
          f"(above the current max, {max(base, top)})")

    if not args.apply:
        print("\nDRY RUN — nothing written. Re-run with --apply.")
        return 0

    os.makedirs(BACKUPS, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = os.path.join(BACKUPS, f"{args.char_name}-{stamp}.sql")
    subprocess.run(
        ["mysqldump"] + DB[:-1] + ["l2jdb", "characters", "character_skills", "items",
                                   "--where", f"1 LIMIT 0"],
        stdout=open(os.devnull, "w"), stderr=subprocess.DEVNULL)
    with open(backup, "w") as f:
        f.write(f"-- pre-seed snapshot of {args.char_name} ({obj_id}) at {stamp}\n")
        f.write(sql(f"SELECT * FROM characters WHERE obj_Id={obj_id}", tabular=True))
        f.write("\n-- skills\n")
        f.write(sql(f"SELECT * FROM character_skills WHERE char_obj_id={obj_id}",
                    tabular=True))
        f.write("\n-- items\n")
        f.write(sql(f"SELECT * FROM items WHERE owner_id={obj_id}", tabular=True))
    print(f"\nbackup      {os.path.relpath(backup, REPO)}")

    stmts = [
        f"UPDATE characters SET level={args.level}, exp={exp}, sp=1000000 "
        f"WHERE obj_Id={obj_id};",
        f"DELETE FROM character_skills WHERE char_obj_id={obj_id};",
    ]
    if args.gm:
        stmts.append(f"UPDATE characters SET accesslevel=7 WHERE obj_Id={obj_id};")
    for sid, slvl in sorted(skills.items()):
        stmts.append(
            f"INSERT INTO character_skills (char_obj_id,skill_id,skill_level,class_index) "
            f"VALUES ({obj_id},{sid},{slvl},0);")
    for n, (iid, cnt) in enumerate(KIT):
        stmts.append(
            f"INSERT INTO items (owner_id,object_id,item_id,count,enchant_level,"
            f"loc,loc_data,custom_type1,custom_type2,mana_left,time) VALUES "
            f"({obj_id},{next_id + n},{iid},{cnt},0,'INVENTORY',0,0,0,-1,0);")

    sql("START TRANSACTION; " + " ".join(stmts) + " COMMIT;")
    print(f"applied     level {args.level}, {len(skills)} skills, {len(KIT)} items")
    print("\nNEXT: restart the gameserver so IdFactory registers the new object ids.")
    print("  Check first whether a watchdog is running -- it may not be:")
    print("    pgrep -fl GameServer_loop.sh")
    print("  With a loop: kill only the java process and it respawns.")
    print("    pkill -f net.sf.l2j.gameserver.GameServer")
    print("  WITHOUT a loop (a raw java start), you must start it again yourself:")
    print("    pkill -f net.sf.l2j.gameserver.GameServer   # SIGTERM, never -9")
    print("    cd server/aCis_gameserver/build/dist/gameserver && \\")
    print("      JAVA_HOME=/opt/homebrew/opt/openjdk@21 \\")
    print("      PATH=$JAVA_HOME/bin:$PATH nohup java -Xms512m -Xmx2g \\")
    print("      -cp './libs/*' net.sf.l2j.gameserver.GameServer > log/stdout.log 2>&1 &")
    return 0


if __name__ == "__main__":
    sys.exit(main())
