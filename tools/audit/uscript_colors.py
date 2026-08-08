#!/usr/bin/env python3
"""Harvest every literal RGB colour the retail UI code sets, from the
decompiled UnrealScript in `assets/uscript/`.

`Interface.xdat` gives a colour for 708 controls that OWN a text record, but
it says nothing about colours the client assigns at RUNTIME -- list-row text,
name colours, adena, the pledge line.  Those live in the `.uc` as three
consecutive field assignments:

    Gold.R = 176;
    Gold.G = 153;
    Gold.B  = 121;

This script pairs them up (same variable, consecutive R/G/B, in one function)
and prints the palette with its call sites, so a port can cite a colour
instead of choosing one.  Together with `assets/gamedata/interface.json` this
is the complete decoded colour ground truth available without running the
retail client.

Read-only.  Writes nothing.

  python3 tools/audit/uscript_colors.py
  python3 tools/audit/uscript_colors.py --hex '#B09B79'   # who uses this colour
  python3 tools/audit/uscript_colors.py --check
"""

import argparse
import collections
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
USCRIPT = os.path.join(REPO, "assets/uscript")

ASSIGN = re.compile(r"^\s*([A-Za-z_][\w.]*)\.([RGBA])\s*=\s*(\d+)\s*;", re.M)


def harvest():
    """{(#RRGGBB) -> [(file, line, varname)]} for complete R+G+B triples."""
    out = collections.defaultdict(list)
    partial = 0
    for root, _dirs, files in os.walk(USCRIPT):
        for fn in sorted(files):
            if not fn.endswith(".uc"):
                continue
            path = os.path.join(root, fn)
            lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
            # collect per-variable channel assignments with their line numbers
            pend = {}
            for i, line in enumerate(lines, 1):
                m = ASSIGN.match(line)
                if not m:
                    continue
                var, chan, val = m.group(1), m.group(2), int(m.group(3))
                slot = pend.setdefault(var, {})
                # A variable reassigned later in the file is a NEW colour, so a
                # channel that is already set closes the previous triple.
                if chan in slot:
                    slot.clear()
                slot[chan] = (val, i)
                if all(c in slot for c in "RGB"):
                    r, g, b = slot["R"][0], slot["G"][0], slot["B"][0]
                    if max(r, g, b) <= 255:
                        out[f"#{r:02X}{g:02X}{b:02X}"].append(
                            (os.path.relpath(path, REPO), slot["R"][1], var))
                    slot.clear()
            partial += sum(1 for s in pend.values() if s)
    return out, partial


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hex", help="show call sites for one colour")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    pal, partial = harvest()
    if not pal:
        print("no colours harvested -- is assets/uscript/ populated?", file=sys.stderr)
        return 2

    if args.hex:
        key = args.hex.upper()
        if not key.startswith("#"):
            key = "#" + key
        sites = pal.get(key)
        if not sites:
            print(f"{key}: not set anywhere in assets/uscript/")
            return 1
        print(f"{key}: {len(sites)} assignment(s)")
        for f, ln, var in sites:
            print(f"  {f}:{ln}  {var}")
        return 0

    total = sum(len(v) for v in pal.values())
    print(f"{total} literal RGB triples, {len(pal)} distinct colours"
          f"  ({partial} incomplete R/G/B groups skipped)\n")
    print(f"{'colour':<10}{'uses':>6}  variables / files")
    for col, sites in sorted(pal.items(), key=lambda kv: -len(kv[1])):
        varnames = sorted({v for _f, _l, v in sites})
        files = sorted({os.path.basename(f) for f, _l, _v in sites})
        print(f"{col:<10}{len(sites):>6}  {', '.join(varnames[:4])}"
              f"{' ...' if len(varnames) > 4 else ''}"
              f"   [{', '.join(files[:3])}{' ...' if len(files) > 3 else ''}]")

    if args.check:
        # Anchor: the L2 tan/gold every window uses for secondary text.  If
        # this stops appearing, the uscript tree or this parser has moved.
        if "#B09B79" not in pal:
            print("\n--check FAIL: #B09B79 (176,155,121) not found", file=sys.stderr)
            return 1
        print(f"\n--check OK: #B09B79 present ({len(pal['#B09B79'])} sites)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
