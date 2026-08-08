#!/usr/bin/env python3
"""Probe: how many Interface.xdat records carry a decodable text colour, by
control type -- and does `parse_xdat.py`'s `type == "TextBox"` gate throw any
away?

Motivation.  `assets/gamedata/interface.json` ships 650 decoded control
colours, but `parse_xdat.py` only attempts the decode for records whose type
is exactly `TextBox`:

    if rec["type"] == "TextBox":
        txt = parse_text_block(...)

Meanwhile the client hard-codes 164 hex colours in `editor/world/js/ui`, most
of them on BUTTON labels, and calls `Layout.color()` exactly twice.  If Button
records carry the same `-9999 <id> -9999 <BGRA>` tail that TextBox records do,
the button-label colours are already in the file and were simply never asked
for.  This script answers that without touching parse_xdat.py: it imports the
module, re-runs its own scanner, and applies `parse_text_block` to EVERY
record regardless of type.

Read-only.  Writes nothing.

  python3 tools/audit/probe_xdat_colors.py
  python3 tools/audit/probe_xdat_colors.py --check
"""

import argparse
import collections
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools/xdat"))

import parse_xdat as X            # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    data = open(X.SRC, "rb").read()
    # scan() is parse_xdat's own record walker; whatever it returns is the same
    # record set the shipped interface.json was built from.
    declared, records = X.scan(data)
    print(f"declared window count    {declared}")

    per_type = collections.Counter()
    with_colour = collections.Counter()
    colours = collections.Counter()
    examples = collections.defaultdict(list)

    for rec in records:
        t = rec.get("type") or "Window"
        per_type[t] += 1
        txt = X.parse_text_block(X.Reader(data), rec["body"], rec["end"])
        if txt and txt.get("color"):
            with_colour[t] += 1
            colours[txt["color"]] += 1
            if len(examples[t]) < 6:
                examples[t].append((rec.get("name"), txt.get("color"),
                                    txt.get("textId"), txt.get("align")))

    total = sum(with_colour.values())
    gated = with_colour.get("TextBox", 0)
    print(f"records scanned          {len(records)}")
    print(f"records with a colour    {total}")
    print(f"  emitted today (TextBox) {gated}")
    print(f"  DISCARDED by the gate   {total - gated}\n")

    print(f"{'type':<24}{'records':>9}{'with colour':>13}")
    for t, n in per_type.most_common():
        if with_colour[t]:
            print(f"{t:<24}{n:>9}{with_colour[t]:>13}")

    print("\n== colours the gate currently discards, by type ==")
    for t in sorted(with_colour):
        if t == "TextBox":
            continue
        print(f"\n  {t}  ({with_colour[t]} records)")
        for name, col, tid, al in examples[t]:
            print(f"    {name:<38} {col}  textId={tid} align={al}")

    if args.check:
        # The claim this probe exists to hold: the gate is lossy.
        if total <= gated:
            print("\n--check: gate is NOT lossy (TextBox is the only carrier)")
            return 0
        print(f"\n--check: gate discards {total - gated} decodable colours")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
