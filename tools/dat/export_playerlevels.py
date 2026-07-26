#!/usr/bin/env python3
"""Export the level -> required-exp table for the client.

StatusWnd.uc drives the EXP gauge with SetPointExp(curExp, level): the client
is given ABSOLUTE exp and derives the bar fraction itself from the level
thresholds. The browser client needs the same table to do the same thing,
otherwise a real character's exp renders as an empty bar.

Source of truth is the server's own data, so the browser and aCis agree:
  server/.../data/xml/playerLevels.xml  ->  assets/gamedata/playerlevels.json

Usage:
  python3 tools/dat/export_playerlevels.py [--check]
"""

import argparse
import json
import os
import sys
import xml.etree.ElementTree as ET

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO,
                   "server/aCis_gameserver/build/dist/gameserver/data/xml/playerLevels.xml")
OUT = os.path.join(REPO, "assets/gamedata/playerlevels.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(SRC):
        sys.exit(f"missing {SRC} — is the datapack built?")

    root = ET.parse(SRC).getroot()
    table = {}
    for pl in root.iter("playerLevel"):
        table[int(pl.get("level"))] = int(pl.get("requiredExpToLevelUp"))

    levels = sorted(table)
    ok = levels == list(range(1, len(levels) + 1)) and table[1] == 0
    mono = all(table[b] >= table[a] for a, b in zip(levels, levels[1:]))

    print(f"levels      {levels[0]}..{levels[-1]} ({len(levels)})")
    print(f"exp at 40   {table.get(40, 0):,}")
    print(f"contiguous  {ok}   monotonic {mono}")

    if args.check:
        print("CHECK", "PASS" if (ok and mono) else "FAIL")
        return 0 if (ok and mono) else 1
    if not (ok and mono):
        sys.exit("refusing to write a non-monotonic / gapped table")

    with open(OUT, "w") as f:
        json.dump({"source": "playerLevels.xml",
                   "requiredExpToLevelUp": {str(k): table[k] for k in levels}}, f)
    print(f"wrote       {os.path.relpath(OUT, REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
