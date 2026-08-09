#!/usr/bin/env python3
"""No-guess audit — find hand-authored numbers in the UI port.

The house rule for this port is that no geometry may be invented: every
number must come from a source that outranks a human's judgement.

  tier 1  client data     Interface.xdat, *.gly            -> Layout.*
  tier 2  client code     Interface.u / NWindow.u          -> documented
  tier 3  the art itself  measured content rects           -> Skin.content()
  tier 4  server data     aCis XML, live packets           -> *.json
  tier 5  native DLLs     hardcoded C++ constants          -> not yet mined
  tier 6  empirical       retail capture                   -> last resort

This tool makes that rule mechanical instead of a habit. It scans the UI
modules for retail-pixel literals -- `Skin.px(<number>)` is, by definition, a
number someone typed -- and reports every one that is not either

  * justified by an AUTHORED / DEVIATION / MEASURED marker nearby, or
  * a defensive fallback for missing data (`Layout.size(...) || {w: 239}`).

Exit code is non-zero when unjustified literals exist, so it can gate a build.

Usage:
  python3 tools/ui/audit_guesses.py
  python3 tools/ui/audit_guesses.py --check     # fail on unjustified numbers
  python3 tools/ui/audit_guesses.py --verbose   # show justified ones too
"""

import argparse
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UI_DIR = os.path.join(REPO, "editor/world/js/ui")

# A retail-pixel literal: Skin.px(12), Skin.px(4 + 3) ... but NOT Skin.px(x)
PX_LITERAL = re.compile(r"Skin\.px\(\s*([0-9][0-9\s+\-*/.]*)\)")
# A fallback for absent data is legitimate: `Layout.size(..) || { w: 239 }`
FALLBACK = re.compile(r"\|\|\s*\{[^}]*[0-9]")
# Markers that justify a literal
# SOURCED = taken from decompiled client code (tier 2); MEASURED = from the
# art (tier 3); AUTHORED = genuinely ours, with a reason; DEVIATION = a
# knowing departure from retail.
MARKER = re.compile(r"AUTHORED|DEVIATION|MEASURED|SOURCED", re.IGNORECASE)
# Values that are not geometry in any meaningful sense
TRIVIAL = {"0", "1", "2", "3"}

# AUTHORED window: how far above a literal this tool looks for a marker
# comment. Wider than tools/audit/unsourced.py's 4, deliberately -- that one
# tightened its window after 14 lines produced false SOURCED verdicts.
LOOKBACK = 8


def justified(lines, i):
    """A marker on this line, or in the comment block just above it."""
    if MARKER.search(lines[i]):
        return True
    for j in range(max(0, i - LOOKBACK), i):
        stripped = lines[j].strip()
        if stripped.startswith(("//", "*", "/*")) and MARKER.search(stripped):
            return True
    return False


def audit_file(path):
    lines = open(path, encoding="utf-8").read().splitlines()
    findings = []
    for i, line in enumerate(lines):
        if FALLBACK.search(line):
            findings.append((i + 1, line.strip(), "fallback", True))
            continue
        for m in PX_LITERAL.finditer(line):
            expr = m.group(1).strip()
            if expr in TRIVIAL:
                continue
            findings.append((i + 1, line.strip(), f"Skin.px({expr})",
                             justified(lines, i)))
    return findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(UI_DIR):
        sys.exit(f"missing {UI_DIR}")

    total = unjustified = 0
    for fn in sorted(os.listdir(UI_DIR)):
        if not fn.endswith(".js"):
            continue
        found = audit_file(os.path.join(UI_DIR, fn))
        if not found:
            continue
        bad = [f for f in found if not f[3]]
        total += len(found)
        unjustified += len(bad)

        show = found if args.verbose else bad
        if show:
            print(f"\n{fn}")
            for ln, text, what, ok in show:
                flag = "ok  " if ok else "GUESS"
                # AUTHORED terminal width for the report line; 81 + 3 dots.
                snippet = text if len(text) <= 84 else text[:81] + "..."
                print(f"  {flag}  L{ln:<4} {what:<16} {snippet}")

    print(f"\nretail-pixel literals: {total}   unjustified: {unjustified}")
    if unjustified:
        print("\nEach GUESS must either be derived (Layout.* / Skin.content())")
        print("or carry an AUTHORED / DEVIATION / MEASURED comment saying why")
        print("no higher-tier source can state it.")

    if args.check:
        print("CHECK", "FAIL" if unjustified else "PASS")
        return 1 if unjustified else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
