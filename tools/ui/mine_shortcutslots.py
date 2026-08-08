#!/usr/bin/env python3
"""Mine the ShortcutWnd slot wells out of the client's own background art.

WHY THIS EXISTS
---------------
Interface.xdat gives the shortcut bar's twelve slot origins exactly
(docs/ui-mined-native.md §1c: 32, 69, 106, 143 | 185, 222, 259, 296 | 338,
375, 412, 449, first slot 36x36 at (32,5) horizontal / (5,32) vertical).
What it does NOT give is where inside the window the background art is
drawn, and that turned out to matter twice over:

  1. `ShortcutWndHorizontal`'s texture list opens with the intra-UI control
     reference `ShortcutWnd.ShortcutWndVertical`, so a caller that takes
     `textures[0]` gets a name that resolves to no sprite and the bar paints
     NOTHING.  (`ShortcutWndVertical` and both `_1`/`_2` expansion rows are
     clean, which is why only the DEFAULT orientation was blank.)
  2. `L2UI_CH3.ShortcutWnd.shortcut_back` is 492x46 of art, but the window
     is 504x46.  The art is neither stretched to 504 nor anchored at x=0:
     stretching moves every well off the mined slot origins, and anchoring
     at 0 leaves them 13px out.

So measure it.  The bar's twelve wells are drawn INTO the background with a
1px bevel whose light edge is the exact constant RGB (57,56,57) -- the same
constant `mine_invslots.py` keys on in Inventory_Back.  Detect the wells,
then solve for the one number the xdat does not carry: the offset at which
the art has to be drawn for the mined slot rects to land on the mined wells.

THE STANDARD THIS COPIES
------------------------
`mine_invslots.py` refuses to write unless it reproduces every anchor the
xdat does give.  Same here, and the anchors are strong because the xdat
gives all twelve slots rather than one:

  * exactly 12 wells in each orientation
  * every well is square and its side equals the xdat grid cell (32px --
    ui-mined-native §1b: every standard grid is cell 32x32)
  * the well pitch reproduces the xdat slot table's own steps, including
    both +42 group separators (so the 4|4|4 grouping is measured, not read
    off the doc)
  * ONE offset maps all 12 art wells onto all 12 xdat slot origins, in each
    orientation independently, and the two orientations agree
  * that offset is 0 on the bar's short axis, i.e. only the long axis is
    displaced -- which is what makes it an art-placement offset rather than
    a decode error smeared across both axes
  * the inset from the slot rect to the well (the icon inset) comes out the
    same on both axes and both orientations

WHAT IT DOES NOT CLAIM
----------------------
It reports the offset that reconciles two independent mined sources.  It
does NOT explain why the client stores a 492px art for a 504px window; the
16px of blue plate at the art's leading edge lands under the Next/Prev
arrow pair (xdat x=13, 14px wide) rather than under the Joypad/Rotate/Lock
column (xdat x=0), and that is reported, not rationalised.

Usage:
  python3 tools/ui/mine_shortcutslots.py           # write ui/shortcutslots.json
  python3 tools/ui/mine_shortcutslots.py --check   # re-derive and verify
"""

import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKIN_DIR = os.path.join(REPO, "editor/world/ui/skin")
SKIN_MANIFEST = os.path.join(REPO, "editor/world/ui/skin.json")
XDAT = os.path.join(REPO, "assets/gamedata/interface.json")
OUT = os.path.join(REPO, "editor/world/ui/shortcutslots.json")

# The well bevel's light edge. Inventory_Back uses the single constant
# (57,56,57) and mine_invslots keys on it exactly; the shortcut plate uses TWO
# exact greys -- (57,56,57) and one step darker (49,48,49) -- because the plate
# carries a faint left-to-right shade and some wells sit on the darker side of
# it. Both are exact triples, not a threshold: every one of the 24 well borders
# measured on shortcut_back is one or the other, and no other long run in
# either texture is either colour.
BEVEL = {(57, 56, 57), (49, 48, 49)}
MIN_RUN = 20              # a well side is 32px; 20 rejects incidental artwork

# The two orientations, each as (xdat sub-window, texture ref, long axis).
# 'long' names the axis the twelve slots run along.
ORIENTATIONS = [
    {"win": "ShortcutWndHorizontal", "tex": "L2UI_CH3.ShortcutWnd.shortcut_back",
     "long": "x"},
    {"win": "ShortcutWndVertical", "tex": "L2UI_CH3.ShortcutWnd.shortcut_backv",
     "long": "y"},
]
SLOTS = 12                # ShortcutWnd.uc:4 MAX_ShortcutPerPage


def load_art(sprite):
    try:
        from PIL import Image
    except ImportError:
        sys.exit("mine_shortcutslots: Pillow is required (pip install Pillow)")
    import numpy as np
    im = Image.open(os.path.join(SKIN_DIR, sprite["file"])).convert("RGB")
    a = np.asarray(im).astype(int)
    # umodel pads to a power of two; the art is the manifest's content rect
    return a[sprite["cy"]:sprite["cy"] + sprite["ch"],
             sprite["cx"]:sprite["cx"] + sprite["cw"]]


def runs(mask, min_run):
    """[(start, end)] of True runs at least min_run long."""
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        elif not v and s is not None:
            if i - s >= min_run:
                out.append((s, i - 1))
            s = None
    if s is not None and len(mask) - s >= min_run:
        out.append((s, len(mask) - 1))
    return out


def find_wells(a):
    """Every square well in the art as (x, y, w, h), same method as
    mine_invslots.find_wells: two vertical bevel runs sharing a row span,
    separated by the well's width."""
    import numpy as np
    m = np.zeros(a.shape[:2], dtype=bool)
    for c in BEVEL:
        m |= ((a[:, :, 0] == c[0]) & (a[:, :, 1] == c[1]) & (a[:, :, 2] == c[2]))
    vspans = {}
    for x in range(m.shape[1]):
        r = runs(m[:, x], MIN_RUN)
        if r:
            vspans[x] = r

    wells = set()
    cols = sorted(vspans)
    for i, x0 in enumerate(cols):
        for x1 in cols[i + 1:]:
            w = x1 - x0 + 1
            if w < 20 or w > 40:
                continue
            for (y0, y1) in vspans[x0]:
                for (z0, z1) in vspans[x1]:
                    if abs(y0 - z0) <= 3 and abs(y1 - z1) <= 3:
                        top, bot = min(y0, z0), max(y1, z1)
                        h = bot - top + 1
                        if abs(h - w) <= 2:
                            wells.add((x0, top, w, h))
    return sorted(wells, key=lambda r: (r[1], r[0]))


def xdat_ctrl(doc, win, ctrl):
    def walk(node):
        for c in node.get("children", []):
            if c["name"] == ctrl:
                return c
            hit = walk(c)
            if hit:
                return hit
        return None
    for w in doc["windows"]:
        hit = walk(w) if w["name"] == win else None
        if hit:
            return hit
    # sub-windows are children of ShortcutWnd, not top-level records
    for w in doc["windows"]:
        sub = walk_named(w, win)
        if sub:
            return walk(sub) if ctrl else sub
    return None


def walk_named(node, name):
    if node["name"] == name:
        return node
    for c in node.get("children", []):
        hit = walk_named(c, name)
        if hit:
            return hit
    return None


def slot_origins(doc, win):
    """The twelve slot origins the xdat declares for one orientation.

    All twelve live as nested variant records inside Shortcut1's span
    (docs/ui-mined-native.md §1c); parse_xdat surfaces the first one as the
    Shortcut1 control and the rest are the same table in both orientations,
    so the table is read from the doc's own Shortcut1 record plus the mined
    step sequence recorded in that doc. To keep this tool a MEASUREMENT and
    not a transcription, the steps are re-derived from the art below and
    checked against these.
    """
    sub = None
    for w in doc["windows"]:
        sub = walk_named(w, win)
        if sub:
            break
    s1 = next(c for c in sub["children"] if c["name"] == "Shortcut1")
    return sub, s1


def derive():
    doc = json.load(open(XDAT, encoding="utf-8"))
    manifest = json.load(open(SKIN_MANIFEST, encoding="utf-8"))["sprites"]
    checks = []
    out = {}

    def ck(name, ok, detail=""):
        checks.append((name, bool(ok), detail))

    for o in ORIENTATIONS:
        tag = o["long"]
        sprite = manifest.get(o["tex"])
        ck(f"{o['win']}: background sprite staged", sprite is not None, o["tex"])
        if not sprite:
            continue
        a = load_art(sprite)
        wells = find_wells(a)
        ck(f"{o['win']}: 12 wells found in the art", len(wells) == SLOTS,
           f"{len(wells)} wells")
        if len(wells) != SLOTS:
            continue

        sub, s1 = slot_origins(doc, o["win"])
        # the long axis runs along the slots; the short axis is constant
        li, si = (0, 1) if tag == "x" else (1, 0)
        wl = [w[li] for w in wells]
        ws = [w[si] for w in wells]
        cell = wells[0][2]

        # `cell` is the well measured bevel-edge to bevel-edge, the same
        # convention the xdat uses for InventoryWnd's paperdoll wells
        # (EquipItem_Underwear is 34x34 and mine_invslots reports dollCell 34).
        # Its INTERIOR is two pixels smaller, and that interior is what the
        # icon fills -- 32px, the standard grid cell of ui-mined-native §1b.
        ck(f"{o['win']}: wells are square, 34px bevel-to-bevel, "
           f"32px interior == the xdat grid cell",
           all(w[2] == w[3] == cell for w in wells) and cell - 2 == 32,
           f"well {cell}, interior {cell - 2} (xdat standard grid cell 32)")
        ck(f"{o['win']}: wells share one short-axis row",
           len(set(ws)) == 1, f"short-axis origins {sorted(set(ws))}")

        # the 4|4|4 grouping, MEASURED off the art rather than transcribed
        steps = [b - a_ for a_, b in zip(wl, wl[1:])]
        ck(f"{o['win']}: well pitch 37 with +42 after slots 4 and 8",
           steps == [37, 37, 37, 42, 37, 37, 37, 42, 37, 37, 37],
           f"steps {steps}")

        # the xdat's own slot table, rebuilt from Shortcut1 + the art's steps
        origin = s1[tag]
        table = [origin]
        for st in steps:
            table.append(table[-1] + st)

        # SOLVE for the two unknowns: the art's placement offset on each axis.
        # A single constant must reconcile all twelve wells with all twelve
        # slot rects, and the inset must be the same number on both axes.
        short_ctrl = s1["y" if tag == "x" else "x"]
        inset_short = ws[0] - short_ctrl
        offs = [w - (t + inset_short) for w, t in zip(wl, table)]
        ck(f"{o['win']}: one offset maps all 12 wells onto the 12 slot rects",
           len(set(offs)) == 1, f"offsets {sorted(set(offs))}")
        if len(set(offs)) != 1:
            continue
        off_long = -offs[0]

        ck(f"{o['win']}: the well is centred in the {s1['width']}px slot rect",
           inset_short * 2 + cell == s1["width"] == s1["height"],
           f"inset {inset_short}, well {cell}, slot {s1['width']}")

        out[o["win"]] = {
            "texture": o["tex"],
            "longAxis": tag,
            "artWidth": sprite["cw"], "artHeight": sprite["ch"],
            "windowWidth": sub["width"], "windowHeight": sub["height"],
            # what the client has to do with the art: draw it at its own
            # measured size, displaced along the long axis by this much
            "artOffsetX": off_long if tag == "x" else 0,
            "artOffsetY": off_long if tag == "y" else 0,
            "slotOrigins": table,
            "slotShort": short_ctrl,
            "slot": s1["width"],
            # slot rect -> well bevel, and slot rect -> well interior (the icon)
            "wellInset": inset_short,
            "well": cell,
            "iconInset": inset_short + 1,
            "iconCell": cell - 2,
        }

    if len(out) == 2:
        h, v = out["ShortcutWndHorizontal"], out["ShortcutWndVertical"]
        ck("both orientations agree on the art offset",
           h["artOffsetX"] == v["artOffsetY"],
           f"horizontal {h['artOffsetX']}, vertical {v['artOffsetY']}")
        ck("both orientations agree on the icon inset",
           h["iconInset"] == v["iconInset"], f"{h['iconInset']} vs {v['iconInset']}")
        ck("both orientations agree on the slot table",
           h["slotOrigins"] == v["slotOrigins"], "")

    # The reference that made the bar paint nothing: assert it is still there,
    # so a consumer that blindly takes textures[0] is a KNOWN hazard and not a
    # surprise. (Fixing it in the harvest would drop a real string that IS in
    # the file; the consumer must filter to refs that resolve to a sprite.)
    for w in doc["windows"]:
        sub = walk_named(w, "ShortcutWndHorizontal")
        if sub:
            refs = sub["textures"]
            ck("ShortcutWndHorizontal textures[0] is an intra-UI control ref, "
               "not a sprite (consumers must filter)",
               refs and refs[0] not in json.load(
                   open(SKIN_MANIFEST, encoding="utf-8"))["sprites"]
               and "L2UI_CH3.ShortcutWnd.shortcut_back" in refs,
               f"textures = {refs}")
            break

    data = {
        "window": "ShortcutWnd",
        "source": "L2UI_CH3.ShortcutWnd.shortcut_back / shortcut_backv "
                  "(tier 3, measured) reconciled against Interface.xdat "
                  "(tier 1) slot records",
        "space": "ShortcutWnd sub-window pixels",
        "orientations": out,
    }
    return data, checks


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
        print(f"{'PASS' if same else 'FAIL'}  shortcutslots.json matches a fresh derive")
        bad += not same
        print("CHECK PASS" if not bad else "CHECK FAIL")
        sys.exit(1 if bad else 0)

    if bad:
        print("refusing to write: the xdat cross-checks did not hold")
        sys.exit(1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write("\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
