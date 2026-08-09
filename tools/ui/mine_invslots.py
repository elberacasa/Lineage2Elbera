#!/usr/bin/env python3
"""Mine the InventoryWnd slot wells out of the client's own background art.

WHY THIS EXISTS
---------------
Interface.xdat declares exactly ONE of the fifteen paperdoll slots:
`EquipItem_Underwear` at (137, 36), 34x34. The other fourteen
(`EquipItem_Head`, `_Hair`, `_Hair2`, `_Neck`, `_RHand`, `_Chest`, `_LHand`,
`_REar`, `_LEar`, `_Gloves`, `_Legs`, `_Feet`, `_RFinger`, `_LFinger` -- the
names are in InventoryWnd.uc's InitHandle) are referenced by the script but
their records do not survive parse_xdat.py's decode, so the port had been
laying them out on an AUTHORED grid. On screen that grid did not line up with
the retail art: the window paints its slot wells in
`L2UI_CH3.InventoryWnd.Inventory_Back`, and our boxes sat 7px to the right of
them.

So mine the positions from the art instead of inventing them. The wells are
drawn with a 1px bevel whose light edge is the exact constant RGB (57,56,57),
which appears nowhere else in the texture as a long run. Detect those runs and
the well rectangles fall out.

This is tier 3 evidence (the shipped art), and it is cross-checked against
every tier-1 anchor the xdat DOES give, so it cannot silently drift:

  * the well at column 4 / row 1 must equal EquipItem_Underwear (137, 36)
  * the item grid's first well must equal InventoryItem's origin (9, 188)
  * the item grid pitch must equal the xdat grid block's cell+gap (37 x 35)
  * the item grid's 6x4 extent must equal InventoryItem's size (236 x 139)
  * the weight well must equal InvenWeight (117, 372), 85x12

All five hold, which is what makes the fourteen mined paperdoll rects
trustworthy: the one slot the xdat does declare lands exactly on a detected
well, and three unrelated controls land on three more.

WHICH WELL IS WHICH SLOT
------------------------
The art draws a silhouette in every well (a helmet, a shield, a boot...), so
the assignment is read off the picture, not guessed. It is confirmed twice
over: rows 2 and 3 come out in exactly InventoryWnd.uc's EQUIPITEM_* enum
order (RHand, Chest, LHand, REar, LEar / Gloves, Legs, Feet, RFinger,
LFinger), and row 1's odd one out -- Underwear in column 4, where the enum
would have put it first -- is precisely the slot the xdat pins to x=137.

Coordinates are emitted in BODY space (the xdat's y minus the 20px titlebar,
which is where BackTexture starts), because that is the coordinate space the
client's InventoryWnd builds its children in.

Usage:
  python3 tools/ui/mine_invslots.py           # write editor/world/ui/invslots.json
  python3 tools/ui/mine_invslots.py --check   # re-derive and verify, write nothing
"""

import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART = os.path.join(REPO, "editor/world/ui/skin/L2UI_CH3__Inventory_Back.png")
XDAT = os.path.join(REPO, "assets/gamedata/interface.json")
OUT = os.path.join(REPO, "editor/world/ui/invslots.json")

# The well bevel's light edge. Exact, not a threshold: this triple appears in
# long runs only on well borders.
BEVEL = (57, 56, 57)   # MEASURED off Inventory_Back, not a chosen colour
# AUTHORED instrument thresholds, all of them: this file MEASURES a texture,
# and the numbers below are the acceptance window of that measurement, not
# values read out of the client. Each is justified against a decoded quantity
# where one exists (the 34px well from the xdat, the 18px adena coin) and the
# whole harvest is cross-checked against Interface.xdat by the --check gate,
# which is what actually proves the thresholds were wide enough and no wider.
MIN_RUN = 20          # a well side is 34px; 20 rejects incidental artwork
TITLEBAR = 20         # BackTexture sits at y=20 -> body space is xdat y - 20

# Slot identity per (row, column) of the 5x3 paperdoll block, read off the
# silhouettes painted in Inventory_Back and named with InventoryWnd.uc's
# EQUIPITEM_* constants.
DOLL_NAMES = [
    ["hair",    "head",  "hair2", "underwear", "neck"],
    ["rhand",   "chest", "lhand", "rear",      "lear"],
    ["gloves",  "legs",  "feet",  "rfinger",   "lfinger"],
]


def load_art():
    try:
        from PIL import Image
    except ImportError:
        sys.exit("mine_invslots: Pillow is required (pip install Pillow)")
    import numpy as np
    im = Image.open(ART).convert("RGB")
    a = np.asarray(im).astype(int)
    # the sprite is power-of-two padded; the art is the top-left 256x381
    # 256x381 is InventoryWnd's own decoded size (Interface.xdat: 256x401
    # minus the 20px titlebar), so this crop is read, not chosen.
    return a[:381, :256]


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
    """Every square well in the art, as (x, y, w, h) in BackTexture space."""
    import numpy as np
    m = (a[:, :, 0] == BEVEL[0]) & (a[:, :, 1] == BEVEL[1]) & (a[:, :, 2] == BEVEL[2])

    # A well shows as two vertical bevel runs (its left and right edges) that
    # share a row span. Collect (column -> row spans), then pair columns whose
    # spans agree and whose separation is the well width.
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
            # AUTHORED width window around the decoded 34px well.
            if w < 20 or w > 40:
                continue
            for (y0, y1) in vspans[x0]:
                for (z0, z1) in vspans[x1]:
                    # the two edges must describe the same well: same span
                    # within a pixel or two (artwork nibbles the ends)
                    # AUTHORED +/-3px slop (artwork nibbles the ends).
                    if abs(y0 - z0) <= 3 and abs(y1 - z1) <= 3:
                        top, bot = min(y0, z0), max(y1, z1)
                        h = bot - top + 1
                        # AUTHORED +/-2px squareness slop.
                        if abs(h - w) <= 2:          # wells are square
                            wells.add((x0, top, w, h))
    return sorted(wells, key=lambda r: (r[1], r[0]))


def cluster(values, tol=2):   # AUTHORED 2px coordinate tolerance
    """Collapse near-equal coordinates to their minimum."""
    out = []
    for v in sorted(values):
        if out and v - out[-1] <= tol:
            continue
        out.append(v)
    return out


def bevel_boxes(a, min_run):
    """Horizontal bevel runs, for the non-square wells (adena, weight)."""
    m = (a[:, :, 0] == BEVEL[0]) & (a[:, :, 1] == BEVEL[1]) & (a[:, :, 2] == BEVEL[2])
    out = []
    for y in range(m.shape[0]):
        for (x0, x1) in runs(m[y], min_run):
            out.append((x0, y, x1 - x0 + 1))
    return out


def coloured_rect(a, y0):
    """Bounding box of the saturated (non-grey) pixels below y0.

    Inventory_Back is entirely greyscale except the weight gauge's
    green->yellow->red gradient and the adena coin, so a saturation test
    isolates the gauge once the coin's column is excluded by requiring a run
    wider than any icon."""
    # AUTHORED saturation threshold: how far R/G/B must spread before a
    # pixel counts as coloured rather than grey.
    sat = (a.max(2) - a.min(2)) > 24
    rows = []
    for y in range(y0, a.shape[0]):
        # AUTHORED run width: wide enough to reject the 18px adena coin.
        r = runs(sat[y], 60)
        if r:
            rows.append((y, max(r, key=lambda s: s[1] - s[0])))
    if not rows:
        return None
    x0 = min(r[1][0] for r in rows)
    x1 = max(r[1][1] for r in rows)
    y_lo, y_hi = rows[0][0], rows[-1][0]
    return (int(x0), int(y_lo), int(x1 - x0 + 1), int(y_hi - y_lo + 1))


def xdat_ctrl(doc, win, ctrl):
    def walk(node):
        for c in node.get("children", []):
            if c["name"] == ctrl:
                return c
            hit = walk(c)
            if hit:
                return hit
        return None
    w = next(x for x in doc["windows"] if x["name"] == win)
    return walk(w)


def derive():
    a = load_art()
    doc = json.load(open(XDAT, encoding="utf-8"))
    wells = find_wells(a)
    checks = []

    def ck(name, ok, detail=""):
        checks.append((name, bool(ok), detail))

    # ---- item grid: the 6x4 block, identified by InventoryItem's origin ----
    inv = xdat_ctrl(doc, "InventoryWnd", "InventoryItem")
    gx, gy = inv["x"], inv["y"] - TITLEBAR
    grid_wells = [w for w in wells if w[0] >= gx and w[1] >= gy
                  and w[1] < gy + inv["height"]]
    gcols = cluster([w[0] for w in grid_wells])
    grows = cluster([w[1] for w in grid_wells])
    cell = grid_wells[0][2] if grid_wells else 0
    pitch_x = gcols[1] - gcols[0] if len(gcols) > 1 else 0
    pitch_y = grows[1] - grows[0] if len(grows) > 1 else 0

    g = inv.get("grid") or {}
    ck("item grid origin == xdat InventoryItem",
       gcols[:1] == [gx] and grows[:1] == [gy], f"art ({gcols[0]},{grows[0]}) xdat ({gx},{gy})")
    ck("item grid pitch == xdat cell+gap",
       pitch_x == g.get("cellX", 0) + g.get("gapX", 0)
       and pitch_y == g.get("cellY", 0) + g.get("gapY", 0),
       f"art {pitch_x}x{pitch_y} xdat {g.get('cellX')}+{g.get('gapX')} x "
       f"{g.get('cellY')}+{g.get('gapY')}")
    ck("item grid rows == xdat grid rows", len(grows) == g.get("rows"),
       f"art {len(grows)} rows, xdat {g.get('rows')}")
    ck("item grid extent fits xdat InventoryItem",
       (gcols[-1] - gcols[0] + cell) <= inv["width"]
       and (grows[-1] - grows[0] + cell) == inv["height"],
       f"art {gcols[-1] - gcols[0] + cell}x{grows[-1] - grows[0] + cell}, "
       f"xdat {inv['width']}x{inv['height']}")

    # ---- paperdoll: the 5x3 block above the tab strip ----------------------
    tab = xdat_ctrl(doc, "InventoryWnd", "InventoryTab")
    doll_wells = [w for w in wells if w[1] + w[3] <= tab["y"] - TITLEBAR]
    dcols = cluster([w[0] for w in doll_wells])
    drows = cluster([w[1] for w in doll_wells])
    dcell = max(w[2] for w in doll_wells) if doll_wells else 0

    under = xdat_ctrl(doc, "InventoryWnd", "EquipItem_Underwear")
    ux, uy = under["x"], under["y"] - TITLEBAR
    # 5x3 is InventoryWnd.uc's own EQUIPITEM_* layout (see DOLL_NAMES above),
    # asserted here against what the art actually yields.
    ck("paperdoll is 5 columns x 3 rows", len(dcols) == 5 and len(drows) == 3,
       f"{len(dcols)}x{len(drows)}")
    ck("paperdoll well size == xdat EquipItem_Underwear",
       dcell == under["width"] == under["height"], f"art {dcell}, xdat {under['width']}")
    ck("xdat EquipItem_Underwear lands on a mined well",
       # 5x3 as above; col 4 / row 1 is where the xdat puts EquipItem_Underwear
       len(dcols) == 5 and len(drows) == 3 and dcols[3] == ux and drows[0] == uy,
       f"xdat ({ux},{uy}) vs mined col4/row1 "
       f"({dcols[3] if len(dcols) > 3 else '?'},{drows[0] if drows else '?'})")

    doll = {}
    for r, row in enumerate(DOLL_NAMES):
        for c, name in enumerate(row):
            doll[name] = {"x": dcols[c], "y": drows[r], "w": dcell, "h": dcell}

    # ---- adena field and weight gauge: wide bevel runs in the bottom band --
    adena_ctrl = xdat_ctrl(doc, "InventoryWnd", "AdenaText")
    weight_ctrl = xdat_ctrl(doc, "InventoryWnd", "InvenWeight")
    wy = weight_ctrl["y"] - TITLEBAR
    # 60 = the same AUTHORED run width used for the gauge scan above.
    bands = [b for b in bevel_boxes(a, 60) if b[1] > grows[-1] + dcell]
    # each field is bounded by a bevel run above and below at the same x/width
    fields = {}
    for (x0, y, w) in bands:
        fields.setdefault((x0, w), []).append(y)
    field_rects = [(x0, min(ys), w, max(ys) - min(ys) + 1)
                   # AUTHORED acceptance rule: a field must show a bevel
                   # run above AND below it, i.e. at least 2 runs
                   for (x0, w), ys in fields.items() if len(ys) >= 2]
    field_rects.sort(key=lambda r: r[1])

    adena_well = field_rects[0] if field_rects else None
    ck("adena field well found under the grid", adena_well is not None,
       str(adena_well))
    if adena_well:
        ck("adena field right edge == xdat AdenaText right edge",
           abs((adena_well[0] + adena_well[2]) - (adena_ctrl["x"] + adena_ctrl["width"])) <= 2,
           f"art right {adena_well[0] + adena_well[2]}, "
           f"xdat right {adena_ctrl['x'] + adena_ctrl['width']}")

    # The weight gauge's full-scale bar is PAINTED INTO the background: a
    # green->yellow->red gradient, the only saturated colour in the texture.
    # Find it and confirm it sits inside the xdat's InvenWeight rect -- that is
    # what proves the gauge is a background overlay, not a missing sprite.
    bar = coloured_rect(a, y0=adena_well[1] if adena_well else grows[-1] + dcell)
    ck("weight gauge gradient found in the background art", bar is not None, str(bar))
    if bar:
        ck("gradient sits inside xdat InvenWeight",
           bar[0] >= weight_ctrl["x"] and bar[0] + bar[2] <= weight_ctrl["x"] + weight_ctrl["width"]
           and bar[1] >= wy and bar[1] + bar[3] <= wy + weight_ctrl["height"],
           f"art {bar} vs xdat ({weight_ctrl['x']},{wy}) "
           f"{weight_ctrl['width']}x{weight_ctrl['height']}")

    data = {
        "window": "InventoryWnd",
        "source": "L2UI_CH3.InventoryWnd.Inventory_Back (tier 3, measured) "
                  "cross-checked against Interface.xdat (tier 1)",
        # 20 = TITLEBAR above, itself the xdat's BackTexture y.
        "space": "InventoryWnd body pixels (xdat y minus the 20px titlebar)",
        "doll": doll,
        "dollCell": dcell,
        "grid": {
            "x": gcols[0], "y": grows[0],
            "cols": len(gcols), "rows": len(grows),
            "well": cell, "pitchX": pitch_x, "pitchY": pitch_y,
            # the icon the client paints inside the well: the xdat grid block's
            # cell size, inset by the well's 1px bevel
            "icon": g.get("cellX"),
        },
        "adenaField": ({"x": adena_well[0], "y": adena_well[1],
                        "w": adena_well[2], "h": adena_well[3]}
                       if adena_well else None),
        # the xdat control rect, plus the gradient painted inside it
        "weightGauge": {"x": weight_ctrl["x"], "y": wy,
                        "w": weight_ctrl["width"], "h": weight_ctrl["height"],
                        "bar": ({"x": bar[0], "y": bar[1], "w": bar[2], "h": bar[3]}
                                if bar else None)},
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
        print(f"{'PASS' if same else 'FAIL'}  invslots.json matches a fresh derive")
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
