#!/usr/bin/env python3
"""Which items are shots — mined from the server, because the client cannot say.

Clicking a soulshot does not use it: it toggles AUTOMATIC use, which is a
different packet (RequestAutoSoulShot) from an ordinary item use. So the client
has to know, before the click, that an item is a shot.

The client's own `etcitemgrp.dat` cannot tell it. Soulshot: D-grade (1463)
carries `etcitem_type: 0`, the same value as ordinary etcitems, and nothing
else in the record distinguishes it. The information genuinely is not there —
the same situation as skill weapon requirements (see export_skillweapons.py).

The server has it twice over, in `data/xml/items/*.xml`:

    <item id="1463" type="EtcItem" name="Soulshot: D-grade">
        <set name="default_action" val="soulshot" />
        <set name="handler" val="SoulShots" />

`default_action` is the authoritative one — it is exactly the "what does
clicking this do" semantic, and it is what the retail client keys on.
`handler` is read too, and the two must agree; a mismatch means the datapack
changed shape and this script should be revisited rather than trusted.

Emits assets/gamedata/shots.json:

    {"1463": {"kind": "soulshot", "grade": "D", "name": "Soulshot: D-grade"}}

Usage:
  python3 tools/dat/export_shots.py
  python3 tools/dat/export_shots.py --check    # exit 1 if the output is stale
"""

import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ITEMS_DIR = os.path.join(ROOT, "server", "aCis_datapack", "data", "xml", "items")
OUT = os.path.join(ROOT, "assets", "gamedata", "shots.json")

# default_action -> the kind the client acts on. Fishing shots are deliberately
# absent: RequestAutoSoulShot refuses 6535..6540 outright ("Fishingshots are not
# automatic on retail"), so offering the toggle for them would be a dead click.
ACTIONS = {
    "soulshot": "soulshot",
    "spiritshot": "spiritshot",
}
# The handler each one must carry, as a cross-check. These are the datapack's
# literal spellings — all plural, and "Blessed" is only distinguishable here
# because default_action says plain "spiritshot" for blessed shots too.
HANDLERS = {"SoulShots", "SpiritShots", "BlessedSpiritShots"}

ITEM_RE = re.compile(r'<item\s+id="(\d+)"[^>]*name="([^"]*)"(.*?)</item>', re.S)
SET_RE = re.compile(r'<set\s+name="([^"]+)"\s+val="([^"]*)"\s*/>')


def extract():
    shots, mismatches = {}, []
    for path in sorted(glob.glob(os.path.join(ITEMS_DIR, "*.xml"))):
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        for item_id, name, body in ITEM_RE.findall(text):
            sets = dict(SET_RE.findall(body))
            action = sets.get("default_action")
            if action not in ACTIONS:
                continue
            handler = sets.get("handler")
            if handler not in HANDLERS:
                # Shape changed, or this is a shot the handler table does not
                # cover. Record it rather than silently dropping or including.
                mismatches.append((item_id, name, action, handler))
                continue
            shots[item_id] = {
                "kind": ACTIONS[action],
                "blessed": handler == "BlessedSpiritShots",
                "grade": sets.get("crystal_type") or None,
                "name": name,
            }
    return shots, mismatches


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="verify the committed output matches the datapack")
    args = ap.parse_args()

    if not os.path.isdir(ITEMS_DIR):
        print("FAIL: datapack not found at %s" % ITEMS_DIR)
        return 1

    shots, mismatches = extract()
    if not shots:
        print("FAIL: no shots found — the XML shape probably changed")
        return 1

    for item_id, name, action, handler in mismatches:
        print("NOTE: %s (%s) has default_action=%s but handler=%r — skipped"
              % (item_id, name, action, handler))

    if args.check:
        if not os.path.exists(OUT):
            print("FAIL: %s missing" % OUT)
            return 1
        with open(OUT) as fh:
            have = json.load(fh)
        if have != shots:
            print("FAIL: %s is stale (%d on disk vs %d from the datapack)"
                  % (OUT, len(have), len(shots)))
            return 1
        print("OK: %d shot items, output matches the datapack" % len(shots))
        return 0

    with open(OUT, "w") as fh:
        json.dump(shots, fh, indent=1, sort_keys=True)
    kinds = {}
    for rec in shots.values():
        kinds[rec["kind"]] = kinds.get(rec["kind"], 0) + 1
    print("wrote %s: %d items (%s)"
          % (OUT, len(shots), ", ".join("%s %d" % kv for kv in sorted(kinds.items()))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
