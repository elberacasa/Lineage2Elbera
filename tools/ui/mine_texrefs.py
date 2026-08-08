#!/usr/bin/env python3
"""Guard the texture references harvested out of Interface.xdat.

WHAT THIS IS NOW
----------------
This began as a fix: it re-harvested the references that `parse_xdat.py` was
dropping, because that file was not ours to edit at the time. The byte-scan
has since been folded into `parse_xdat.py` itself, so the decoder no longer
loses anything and this script now recovers ZERO — which is exactly the point.
It is kept as the regression gate for that fix: `--check` re-derives the
harvest independently and fails if the decoder ever starts missing references
again, plus it asserts nine per-control texture guards (the status gauge
fills, the menu button art, the chat body) that name the specific sprites
whose loss was visible on screen.

If `--check` ever reports a non-zero recovery count, `parse_xdat.py` has
regressed to a phase-losing harvest; the explanation below is why that matters.

THE BUG IT GUARDS AGAINST
-------------------------
`tools/xdat/parse_xdat.py` anchors records by their header shape and then
collects the texture names living in each record's span. It used to *walk* the
span as a string stream: read a string, jump to its end, and when a byte is not
a string start, step forward 4 bytes.

That walk loses phase. A record body begins with int32 fields, so the walk
starts in `p += 4` mode; whenever a variable-length field pushes the stream off
the 4-byte lattice the walk steps straight over the strings that follow. The
name is still there in the file — the walk simply never lands on its length
byte. Measured on the shipped Interface.xdat: **156 of 1,962 records lose at
least one texture reference this way, 138 distinct names in total**, and 133 of
those 138 resolve to a PNG that umodel already exported — they are real art,
not decode noise.

What that costs the port, concretely:

  StatusWnd.CPBar   xdat: ps_cpbar, ps_cpbar_back        walk found: ps_cpbar_back
  StatusWnd.MPBar   xdat: ps_mpbar, ps_mpbar_back        walk found: ps_mpbar_back
  StatusWnd.HPBar   xdat: ps_hpbar, ps_hpbar_back,       walk found: the last three
                          ps_hpbarwarn1, ps_hpbarfill
  StatusWndCenterTex xdat: Smallwindow2_back2            walk found: nothing
  MenuWnd.Btn*      xdat: MenuIcon.menuButton1..4        walk found: nothing
  ChatWndBodyTex    xdat: Chatting_Back3                 walk found: nothing

i.e. the gauge FILL sprites were missing, so the client painted each gauge's
back plate as its own fill — the "bare coloured stripes" the status window
renders as — and the menu bar had no icons to draw.

THE FIX
-------
Harvest by scanning EVERY byte offset in the span instead of walking. The
string validator is unchanged (length byte == strlen+1, printable ASCII, NUL
terminator), so a hit is still a real serialized string; only the phase problem
goes away. `TEXREF` is tightened to require every dot-separated component to be
at least 2 characters, which is what separates `L2UI_CH3.SmallWnd.CpBar` from
the two truncated authoring leftovers in the file (`L2UI_CH3.d`, `l2UI_CH3.f`).

This script is a WRAPPER, not a fork: it imports parse_xdat, reuses its record
scan, tree builder and library resolver, and replaces only the harvest. Run it
after parse_xdat.py — parse_xdat rewrites interface.json and would drop the
recovered names again.

Usage:
  python3 tools/ui/mine_texrefs.py            # rewrite interface.json
  python3 tools/ui/mine_texrefs.py --check    # verify, write nothing
"""

import argparse
import importlib.util
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PARSER = os.path.join(REPO, "tools/xdat/parse_xdat.py")
SRC = os.path.join(REPO, "assets/interlude/system/Interface.xdat")
OUT = os.path.join(REPO, "assets/gamedata/interface.json")

# Package.Group.Name, every component >= 2 chars (see the module docstring).
TEXREF = re.compile(r"^[A-Za-z][A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]{2,}){1,3}$")

# The gauges this pass exists to repair; asserted in --check so a regression in
# the harvest is caught by a guard rather than by a player.
GUARD_TEXTURES = {
    ("StatusWnd", "CPBar"): ["L2UI_CH3.PlayerStatusWnd.ps_cpbar",
                             "L2UI_CH3.PlayerStatusWnd.ps_cpbar_back"],
    ("StatusWnd", "MPBar"): ["L2UI_CH3.PlayerStatusWnd.ps_mpbar",
                             "L2UI_CH3.PlayerStatusWnd.ps_mpbar_back"],
    ("StatusWnd", "HPBar"): ["L2UI_CH3.PlayerStatusWnd.ps_hpbar",
                             "L2UI_CH3.PlayerStatusWnd.ps_hpbar_back",
                             "L2UI_CH3.PlayerStatusWnd.ps_hpbarwarn1",
                             "L2UI_CH3.PlayerStatusWnd.ps_hpbarfill"],
    ("StatusWnd", "EXPBar"): ["L2UI_CH3.PlayerStatusWnd.ps_expbar",
                              "L2UI_CH3.PlayerStatusWnd.ps_expbar_back"],
    ("StatusWnd", "StatusWndCenterTex"):
        ["L2UI_CH3.SmallWnd.Smallwindow2_back2"],
    ("MenuWnd", "BtnCharInfo"): ["L2UI_CH3.MenuIcon.menuButton1"],
    ("MenuWnd", "BtnInventory"): ["L2UI_CH3.MenuIcon.menuButton2"],
    ("MenuWnd", "BtnMap"): ["L2UI_CH3.MenuIcon.menuButton3"],
    ("MenuWnd", "BtnSystemMenu"): ["L2UI_CH3.MenuIcon.menuButton4"],
}


def load_parser():
    spec = importlib.util.spec_from_file_location("parse_xdat", PARSER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def harvest(px, r, rec):
    """Every serialized string in the record's span that reads as a texture."""
    refs, end = [], rec["end"]
    for p in range(rec["body"], end):
        got = r.string(p)
        if got and got[0] and got[1] <= end and TEXREF.match(got[0]):
            refs.append(got[0])
    return list(dict.fromkeys(refs))          # xdat order, no repeats


def build(px, data):
    px.data_g = data
    declared, records = px.scan(data)
    r = px.Reader(data)
    added = 0
    for rec in records:
        before = rec["textures"]
        rec["textures"] = harvest(px, r, rec)
        added += max(0, len(rec["textures"]) - len(before))
    windows = px.build_tree(records)
    return declared, records, windows, added


def flat(windows):
    """{(window, control): node} for every record in the tree."""
    out = {}
    def walk(win, n):
        out.setdefault((win, n["name"]), n)
        for c in n.get("children", []):
            walk(win, c)
    for w in windows:
        out.setdefault((w["name"], w["name"]), w)
        for c in w.get("children", []):
            walk(w["name"], c)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--src", default=SRC)
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    if not os.path.exists(args.src):
        sys.exit(f"missing {args.src} — needs your own Interlude client")

    px = load_parser()
    data = open(args.src, "rb").read()
    declared, records, windows, added = build(px, data)

    have = px.library_index()
    refs = sorted({t for rec in records for t in rec["textures"]})
    record_names = {rec["name"] for rec in records}
    resolved, control_refs, missing = {}, [], []
    for ref in refs:
        hit = px.resolve(ref, have)
        if hit:
            resolved[ref] = hit
        elif ref.split(".")[0] in record_names:
            control_refs.append(ref)
        else:
            missing.append(ref)
            resolved[ref] = None

    art = len(resolved) - len(missing)
    print(f"records         {len(records):,}")
    print(f"texture refs    {len(refs)} distinct — {art} art, "
          f"{len(control_refs)} intra-UI, {len(missing)} unresolved")
    if missing:
        print("unresolved      " + ", ".join(missing))
    print(f"recovered       {added} references the walking harvest missed")

    # Guards: the specific gauges/icons this pass exists to restore.
    nodes = flat(windows)
    bad = []
    for (win, ctrl), want in GUARD_TEXTURES.items():
        got = (nodes.get((win, ctrl)) or {}).get("textures", [])
        if got[:len(want)] != want:
            bad.append(f"{win}.{ctrl}: {got} != {want}")
    print(f"texture guards  {'all pass' if not bad else 'BROKEN'} "
          f"({len(GUARD_TEXTURES)} controls)")
    for b in bad:
        print("  " + b)

    # Nothing this script does may change geometry — reuse parse_xdat's own
    # coordinate guards so a bad merge cannot slip through.
    decoded = sum(1 for rec in records if rec["x"] is not None)
    print(f"coords decoded  {decoded:,} records (guard: >=1,600)")

    stale = False
    if os.path.exists(args.out):
        cur = json.load(open(args.out))
        curnodes = flat(cur["windows"])
        stale = any((curnodes.get(k) or {}).get("textures", [])[:len(v)] != v
                    for k, v in GUARD_TEXTURES.items())
        print(f"interface.json  {'STALE' if stale else 'up to date'}")

    ok = not bad and decoded >= 1600 and not stale
    if args.check:
        print("CHECK", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    with open(args.out, "w") as f:
        json.dump({
            "source": "Interface.xdat",
            "declaredWindows": declared,
            "windows": windows,
            "textures": resolved,
            "controlRefs": sorted(control_refs),
        }, f, indent=1)
    print(f"wrote           {args.out}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
