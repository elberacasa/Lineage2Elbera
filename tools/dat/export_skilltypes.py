#!/usr/bin/env python3
"""Export skill operate types (ACTIVE / PASSIVE / TOGGLE) for the client.

Lineage 2 skills come in three kinds and the UI must treat them differently:

  ACTIVE   castable, may sit on the shortcut bar
  TOGGLE   castable, but switches a stance on/off rather than firing once
  PASSIVE  never castable, never goes on the shortcut bar

The live SkillList packet (0x58) carries only a boolean `passive` flag, which
is enough to split the retail skill window's two panes (ESkillCategory is
literally {SKILL_Active, SKILL_Passive}) but NOT enough to tell a toggle from
a normal active. That distinction lives in the server's skill definitions.

Source of truth, so the browser and aCis agree:
  server/.../data/xml/skills/*.xml   <set name="operateType" val="..."/>
    ->  assets/gamedata/skilltypes.json   {skillId: "ACTIVE"|"PASSIVE"|"TOGGLE"}

Usage:
  python3 tools/dat/export_skilltypes.py [--check]
"""

import argparse
import collections
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO,
                   "server/aCis_gameserver/build/dist/gameserver/data/xml/skills")
OUT = os.path.join(REPO, "assets/gamedata/skilltypes.json")

SKILL = re.compile(r'<skill\s+id="(\d+)"')
OPTYPE = re.compile(r'<set\s+name="operateType"\s+val="([A-Z0-9_]+)"')
VALID = {"ACTIVE", "PASSIVE", "TOGGLE"}


def parse():
    """skillId -> operateType, by walking each <skill> block in file order."""
    types = {}
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith(".xml"):
            continue
        text = open(os.path.join(SRC, fn), encoding="utf-8", errors="ignore").read()
        # split on skill openings so an operateType is attributed to its own skill
        parts = SKILL.split(text)
        # parts = [preamble, id1, body1, id2, body2, ...]
        for i in range(1, len(parts) - 1, 2):
            sid, body = int(parts[i]), parts[i + 1]
            m = OPTYPE.search(body)
            if m and m.group(1) in VALID:
                types[sid] = m.group(1)
    return types


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        sys.exit(f"missing {SRC} — is the datapack built?")

    types = parse()
    counts = collections.Counter(types.values())
    print(f"skills      {len(types)}")
    for k in ("ACTIVE", "TOGGLE", "PASSIVE"):
        print(f"  {k:<9} {counts.get(k, 0)}")

    ok = len(types) > 2000 and counts.get("TOGGLE", 0) > 0 and counts.get("PASSIVE", 0) > 0
    if args.check:
        print("CHECK", "PASS" if ok else "FAIL")
        return 0 if ok else 1
    if not ok:
        sys.exit("refusing to write: the parse looks incomplete")

    with open(OUT, "w") as f:
        json.dump({"source": "aCis data/xml/skills",
                   "types": {str(k): v for k, v in sorted(types.items())}}, f)
    print(f"wrote       {os.path.relpath(OUT, REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
