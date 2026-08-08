#!/usr/bin/env python3
"""Resolve classId -> class name through the client's own string table.

WHY THIS EXISTS
---------------
DetailStatusWnd.uc writes the level line as

    txtLvName  =  Level $ " " $ GetClassType(SubClassID)

and `GetClassType` is a native in NWindow.dll, so the port had no class name
to show. It does not need the native: the names are in the client's own
sysstring-e.dat, in two contiguous blocks, and the mapping is a pure offset.

  classId  0..57   ->  sysstring 247 + classId      ('Human Fighter' .. 'Warsmith')
  classId 58..88   ->  sysstring 1159 + classId-58  ('Duelist' .. 'Maestro')

The offsets are not asserted, they are SOLVED and then verified against an
independent source: aCis's own `ClassId` enum, whose ordinal IS the protocol
class id and which carries the English display name as its 4th argument.
All 89 names match, exactly, with no near-misses -- the two-block split falls
out of the data (the first block runs out at sysstring 304 = classId 57 and
305 is 'Graphic Cursor', an options-menu string).

Anything that changes -- a different client's string table, a datapack with a
renamed class -- turns into a FAIL here rather than a wrong word on screen.

Usage:
  python3 tools/ui/mine_classnames.py           # write ui/classnames.json
  python3 tools/ui/mine_classnames.py --check   # re-derive and verify
"""

import argparse
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SYSSTRING = os.path.join(REPO, "assets/gamedata/sysstring.json")
CLASSID = os.path.join(
    REPO, "server/aCis_gameserver/java/net/sf/l2j/gameserver/enums/actors/ClassId.java")
OUT = os.path.join(REPO, "editor/world/ui/classnames.json")

BLOCK1, SPLIT, BLOCK2 = 247, 58, 1159


def sysid(class_id):
    return (BLOCK1 + class_id) if class_id < SPLIT else (BLOCK2 + class_id - SPLIT)


def acis_names():
    """The aCis ClassId enum in ordinal order; ordinal == protocol class id."""
    src = open(CLASSID, encoding="utf-8").read()
    body = src.split("public enum ClassId", 1)[1].split(";", 1)[0]
    return re.findall(
        r'^\s*[A-Z0-9_]+\(ClassRace\.\w+, ClassType\.\w+, \d+, "([^"]+)"',
        body, re.M)


def norm(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def derive():
    strings = {r["id"]: r["string"]
               for r in json.load(open(SYSSTRING, encoding="utf-8"))}
    names = acis_names()
    checks, table, bad = [], {}, []

    for cid, server_name in enumerate(names):
        client_name = strings.get(sysid(cid))
        if norm(client_name) != norm(server_name):
            bad.append((cid, server_name, client_name))
        table[str(cid)] = {"sysId": sysid(cid), "name": client_name}

    checks.append(("aCis ClassId enum parsed (89 ordinals)", len(names) == 89,
                   f"{len(names)} classes"))
    checks.append((f"every classId resolves through sysstring "
                   f"{BLOCK1}+id / {BLOCK2}+id-{SPLIT}",
                   not bad,
                   "all 89 match" if not bad else f"{len(bad)} mismatched: {bad[:3]}"))
    # the split is where the first block runs out, not a chosen number
    checks.append((f"the first block ends at classId {SPLIT - 1}",
                   norm(strings.get(BLOCK1 + SPLIT - 1)) == norm(names[SPLIT - 1])
                   and norm(strings.get(BLOCK1 + SPLIT)) != norm(names[SPLIT]),
                   f"sysstring {BLOCK1 + SPLIT - 1}="
                   f"{strings.get(BLOCK1 + SPLIT - 1)!r}, "
                   f"{BLOCK1 + SPLIT}={strings.get(BLOCK1 + SPLIT)!r}"))

    return {
        "source": "sysstring-e.dat (client) cross-checked against aCis "
                  "ClassId.java (server); classId == enum ordinal",
        "rule": f"sysId = {BLOCK1} + classId for classId < {SPLIT}, "
                f"else {BLOCK2} + classId - {SPLIT}",
        "classes": table,
    }, checks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    data, checks = derive()
    bad = 0
    for name, ok, detail in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
        bad += not ok

    if args.check:
        if not os.path.exists(OUT):
            print(f"FAIL  {OUT} missing (run without --check first)")
            sys.exit(1)
        have = json.load(open(OUT, encoding="utf-8"))
        same = json.dumps(have, sort_keys=True) == json.dumps(data, sort_keys=True)
        print(f"{'PASS' if same else 'FAIL'}  classnames.json matches a fresh derive")
        bad += not same
        print("CHECK PASS" if not bad else "CHECK FAIL")
        sys.exit(1 if bad else 0)

    if bad:
        print("refusing to write: the cross-checks did not hold")
        sys.exit(1)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write("\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
