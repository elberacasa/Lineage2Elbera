#!/usr/bin/env python3
"""Does every value the UI READS actually resolve -- and has the old
`Layout.*(...) || {invented}` shape stayed extinct?

    python3 tools/audit/layout_bind.py            report
    python3 tools/audit/layout_bind.py --check    exit 1 on any failure

WHY THIS EXISTS
---------------
`tools/audit/fallback_reach.py` established that all 53 guarded Layout
lookups in the client resolved, i.e. that the `|| { w: 239, h: 104 }`
literals never rendered.  That made them harmless but not acceptable: the
audit still counts them, and a literal replaced by a better literal is still
a literal.  They were removed in favour of accessors that degrade to nothing
(`Layout.sizeOf` / `posOf` / `gridOf` / `windowSize`) plus the readers for
the two harvests that did not exist before (`Layout.dock`, `Layout.ladder`,
`Layout.htmlColor`).

That trade is only sound if two things stay true, and this tool is what keeps
them true.

GATE A -- the guarded shape is extinct
    A single reintroduced `Layout.size(W, C) || { w: 1, h: 2 }` puts an
    undecoded number back on screen the moment its lookup misses.  This gate
    fails on ANY occurrence.  On the tree as it stood before this pass it
    reports 53 and exits 1, which is the proof that the gate has teeth.

GATE B -- every lookup the UI performs still resolves
    The degrade path of the new accessors paints NOTHING (an empty rect) and
    logs.  That is the honest answer for a decode we do not have, but it must
    never actually be reached, so every window/control pair the client asks
    for is resolved here against the shipped `interface.json`, using Layout's
    own indexing rules -- reusing fallback_reach.py's index and resolver
    rather than a second copy of them.

GATE C -- every named harvest key exists
    `Layout.dock('MultiSellWnd')`, `Layout.native('itemSlotCount')` and
    `Layout.ladder('conColor', ...)` name entries in windowsinfo.json,
    native_colors.json and native_colors.json's `ladders` block.  A typo in
    one of those names is silent: the accessor returns null and the caller
    degrades, exactly as if the harvest were missing.  This gate turns that
    silence into a failure.

WHAT IT DOES NOT CHECK
    Whether the resolved values are RIGHT.  That is what the miners' own
    --check gates do against the binaries (mine_windowsinfo.py,
    mine_native_colors.py).  This tool checks the wiring, not the decode.

Read-only.  Writes nothing.
"""

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import fallback_reach as FR          # noqa: E402  (index + resolver, reused)

JS_ROOT = os.path.join(REPO, "editor/world/js")
DOCKS = os.path.join(REPO, "assets/gamedata/windowsinfo.json")
NATIVE = os.path.join(REPO, "assets/gamedata/native_colors.json")

# GATE A: the shape that must not come back.  Deliberately broader than
# fallback_reach's pattern -- ANY Layout accessor guarded by || or ?? with a
# literal on the right counts, not only the ones that existed then.
GUARDED = re.compile(
    r"Layout\.\w+\s*\([^()]*\)\s*(?:\|\||\?\?)\s*"
    r"(?P<fb>\{[^{}]*\d[^{}]*\}|\[[^\][]*\d[^\][]*\]|-?\d[\d.]*|'#[0-9a-fA-F]{3,8}')")

# GATE B: the degrade-to-nothing accessors, and the plain ones beside them.
BIND = re.compile(
    r"Layout\.(?P<fn>sizeOf|posOf|gridOf|windowSize|autosizeOf)\s*\(\s*"
    r"(?P<win>[A-Za-z_$][\w$.]*|'[^']*'|\"[^\"]*\")\s*"
    r"(?:,\s*(?P<ctrl>'[^']*'|\"[^\"]*\"|[A-Za-z_$][\w$.]*)\s*)?\)")

# GATE C
DOCK = re.compile(r"Layout\.dock\(\s*'([^']+)'\s*\)")
NATIVE_KEY = re.compile(r"Layout\.native\(\s*'([^']+)'\s*\)")
LADDER = re.compile(r"Layout\.ladder\(\s*'([^']+)'")
HTMLCOL = re.compile(r"Layout\.htmlColor\(")

WNDDECL = re.compile(r"const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'")

FN_TO_BASE = {"sizeOf": "size", "posOf": "pos", "gridOf": "grid",
              "windowSize": "window", "autosizeOf": "autosize"}


def js_files():
    out = []
    for root, dirs, files in os.walk(JS_ROOT):
        dirs[:] = [d for d in dirs if d not in ("vendor", "node_modules")]
        for f in sorted(files):
            if f.endswith(".js"):
                out.append(os.path.join(root, f))
    return out


def unquote(s):
    return s[1:-1] if s and s[0] in "'\"" else s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    _doc, flat, paths, windows = FR.build_index()
    docks = json.load(open(DOCKS)) if os.path.exists(DOCKS) else {}
    native = json.load(open(NATIVE)) if os.path.exists(NATIVE) else {}

    fails, guarded_hits, resolved, dyn = [], [], 0, 0

    for path in js_files():
        rel = os.path.relpath(path, REPO)
        src = open(path, encoding="utf-8").read()
        # layout.js itself defines the accessors and documents the shape it
        # replaced; its own text is not a call site.
        if rel.endswith("js/ui/layout.js"):
            consts = {}
        else:
            consts = dict(WNDDECL.findall(src))
            for m in GUARDED.finditer(src):
                ln = src[:m.start()].count("\n") + 1
                guarded_hits.append((rel, ln, m.group(0).strip()[:110]))

        for m in BIND.finditer(src):
            ln = src[:m.start()].count("\n") + 1
            fn = FN_TO_BASE[m.group("fn")]
            raw_win = m.group("win")
            win = unquote(raw_win) if raw_win.startswith(("'", '"')) \
                else consts.get(raw_win)
            ctrl = m.group("ctrl")
            if win is None:
                dyn += 1
                continue
            if win not in windows:
                fails.append(f"{rel}:{ln}: Layout.{m.group('fn')} asks for window "
                             f"{win!r}, which Interface.xdat does not declare")
                continue
            if ctrl is None or not ctrl.startswith(("'", '"')):
                if ctrl is None:
                    if FR.resolve("window", win, None, flat, paths, windows) is None:
                        fails.append(f"{rel}:{ln}: window {win!r} has no size")
                    else:
                        resolved += 1
                    continue
                # dynamic control name: fall back to fallback_reach's
                # proximity scan, which is the same instrument it used.
                cand = FR.candidates(src, win, flat, paths, windows, fn, ln)
                if cand is None:
                    dyn += 1
                    continue
                ok, bad = cand
                if bad:
                    fails.append(f"{rel}:{ln}: Layout.{m.group('fn')}({win}, <dyn>) "
                                 f"would return null for {bad}")
                else:
                    resolved += 1
                continue
            name = unquote(ctrl)
            if FR.resolve(fn, win, name, flat, paths, windows) is None:
                fails.append(f"{rel}:{ln}: Layout.{m.group('fn')}({win!r}, {name!r}) "
                             f"resolves to null -- the empty-rect degrade would "
                             f"render, and it is not a design")
            else:
                resolved += 1

        for m in DOCK.finditer(src):
            n = m.group(1)
            if n not in (docks.get("docks") or {}):
                fails.append(f"{os.path.relpath(path, REPO)}: Layout.dock({n!r}) "
                             f"names no section in windowsinfo.json")
        for m in NATIVE_KEY.finditer(src):
            k = m.group(1)
            if k not in (native.get("colors") or {}):
                fails.append(f"{os.path.relpath(path, REPO)}: Layout.native({k!r}) "
                             f"names no entry in native_colors.json")
        for m in LADDER.finditer(src):
            k = m.group(1)
            if k not in (native.get("ladders") or {}):
                fails.append(f"{os.path.relpath(path, REPO)}: Layout.ladder({k!r}) "
                             f"names no ladder in native_colors.json")
        if HTMLCOL.search(src) and not (native.get("htmlNamedColors") or {}).get("names"):
            fails.append(f"{os.path.relpath(path, REPO)}: Layout.htmlColor() is "
                         f"called but native_colors.json ships no htmlNamedColors")

    print("Layout binding audit")
    print(f"  GATE A  guarded `Layout.*() || literal` sites: {len(guarded_hits)} "
          f"(must be 0)")
    for rel, ln, txt in guarded_hits[:20]:
        print(f"          {rel}:{ln}  {txt}")
    if len(guarded_hits) > 20:
        print(f"          ... and {len(guarded_hits) - 20} more")
    print(f"  GATE B  degrade-accessor lookups that resolve: {resolved} "
          f"({dyn} unresolvable/dynamic, not counted)")
    print(f"  GATE C  dock / native / ladder names checked against the harvests")

    fails = [f"GATE A: guarded fallback at {r}:{l}" for r, l, _ in guarded_hits] + fails
    print()
    if fails:
        print(f"CHECK FAIL ({len(fails)})")
        for f in fails[:40]:
            print("   " + f)
        if len(fails) > 40:
            print(f"   ... and {len(fails) - 40} more")
        return 1 if a.check else 0
    print("CHECK PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
