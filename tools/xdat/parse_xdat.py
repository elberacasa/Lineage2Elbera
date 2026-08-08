#!/usr/bin/env python3
"""ElberaSkin — Interface.xdat -> interface.json (the UI layout ground truth).

The Interlude client stores its entire UI definition in system/Interface.xdat:
every window, every control inside it, sizes, and the texture each one paints
with. Unlike the .dat tables this file is NOT encrypted -- it is a plain
serialized dump of the client's widget tree.

Format, reverse-engineered here (see docs/xdat-format.md):

  u32                       window count
  record*                   flat, depth-first stream of records

  record:
    str    type             (children only; top-level windows have none)
    str    name
    str    "undefined"
    i32 i32
    str    parent           ("" for a top-level window)
    str    "undefined"
    str    "undefined"
    i32    f0
    i32    f1
    i32    hasSize
    i32 i32                 width, height   -- ONLY when hasSize != 0
    ...                     type-dependent tail
    str    stateGroup       ("Game", "GamingState", ...)
    i32    childCount
    record * childCount

  str:  u8 len (= strlen + 1, counting the NUL) + chars + NUL.
        A lone 0x00 byte is the empty string (no NUL follows).

The type-dependent tail is not fully decoded. Rather than guess at it, this
parser anchors on the header shape (which is unambiguous -- three literal
"undefined" strings in fixed positions) and treats the bytes between one
header and the next as that record's span, harvesting package-qualified
texture references out of it. Everything the parser emits is read from a
field it actually decoded; nothing is inferred.

Usage:
  python3 tools/xdat/parse_xdat.py                     # write interface.json
  python3 tools/xdat/parse_xdat.py --check             # verify, write nothing
"""

import argparse
import json
import os
import re
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, "assets/interlude/system/Interface.xdat")
OUT = os.path.join(REPO, "assets/gamedata/interface.json")
LIBRARY = os.path.join(REPO, "assets/library")

# A texture reference looks like  Package.Group.Name  or  Package.Name.
TEXREF = re.compile(r"^[A-Za-z][A-Za-z0-9_\-]*(?:\.[A-Za-z0-9_\-]+){1,3}$")


class Reader:
    def __init__(self, data):
        self.d = data

    def string(self, o):
        """(text, next_offset) or None if o is not a valid string field."""
        d = self.d
        if o >= len(d):
            return None
        n = d[o]
        if n == 0:
            return "", o + 1
        nul = o + n
        if nul >= len(d) or d[nul] != 0:
            return None
        raw = d[o + 1:nul]
        if not all(32 <= c < 127 for c in raw):
            return None
        return raw.decode("ascii"), nul + 1

    def i32(self, o):
        return struct.unpack_from("<i", self.d, o)[0]


def parse_header(r, o):
    """Decode a record header at o, or None if the shape does not match.

    The three fixed "undefined" strings make this a strong anchor: a false
    positive would need that exact interleaving of strings and int32s.
    """
    got = r.string(o)
    if not got or not got[0]:
        return None
    name, p = got

    got = r.string(p)
    if not got or got[0] != "undefined":
        return None
    p = got[1]

    f_a, f_b = r.i32(p), r.i32(p + 4)
    p += 8

    got = r.string(p)
    if got is None:
        return None
    parent, p = got

    for _ in range(2):
        got = r.string(p)
        if not got or got[0] != "undefined":
            return None
        p = got[1]

    f0, f1, has_size = r.i32(p), r.i32(p + 4), r.i32(p + 8)
    p += 12
    width = height = None
    if has_size:
        width, height = r.i32(p), r.i32(p + 4)
        p += 8

    # docs/ui-mined-values.md §4: x/y are 24.8 fixed point at body+12/+16.
    # Accept only when BOTH ints are divisible by 256 (p(false positive)
    # ~2^-16 per record); otherwise the record is undecoded -- never guess.
    x = y = None
    tail = None
    if has_size:
        x_raw, y_raw = r.i32(p + 12), r.i32(p + 16)
        if x_raw % 256 == 0 and y_raw % 256 == 0:
            x, y = x_raw // 256, y_raw // 256
    else:
        # docs/xdat-tail-has0.md: hasSize==0 records carry x/y as plain
        # pixel ints at body+30/+34, behind an auto-size block. The decode
        # is gated on the full structural signature (zero bytes, floats in
        # [0,1], small enum ints, the -1/0 enum pair, a literal "undefined"
        # string and the -9999 sentinel); any deviation = undecoded.
        tail = parse_has0_tail(r, p)
        if tail:
            x, y = tail["x"], tail["y"]

    rec = {
        "name": name,
        "parent": parent,
        "off": o,
        "body": p,
        "flags": [f_a, f_b, f0, f1],
        "width": width,
        "height": height,
        "x": x,
        "y": y,
    }
    if tail:
        rec["autosize"] = tail["autosize"]
        rec["insets"] = tail["insets"]
    return rec


# docs/ui-mined-native.md §1b: every ItemWindow record carries, in its
# span, a 7-int 24.8 fixed-point grid block:
#   [f0, rows, capacity, cellX, cellY, gapX, gapY]
# f0 is a constant 0x6FF across all standard grids (NOT columns — columns
# derive from pane width / pitch); cellX == cellY in {24,32,36} px, gapX in
# {0,5}px, gapY in {0,3}px. The block's offset varies per record tail, so
# it is found by signature, never by fixed offset.
GRID_CELLS = {24 * 256, 32 * 256, 36 * 256}
GRID_GAPX = {0, 5 * 256}
GRID_GAPY = {0, 3 * 256}


def parse_grid(r, body, end):
    d = r.d
    # fields are packed unaligned (variable-length strings precede them) —
    # scan every offset; the signature (cell in {24,32,36}px, gaps in
    # {0,5}/{0,3}px as 24.8 fixed point) is what keeps this exact
    for o in range(body, end - 28, 1):
        v = struct.unpack_from("<7i", d, o)
        _, rows, cap, cx, cy, gx, gy = v
        if (rows >= 1 and cap >= 1
                and cx == cy and cx in GRID_CELLS
                and gx in GRID_GAPX and gy in GRID_GAPY):
            return {
                "rows": rows // 256 if rows % 256 == 0 else rows / 256,
                "capacity": cap // 256 if cap % 256 == 0 else cap / 256,
                "cellX": cx // 256, "cellY": cy // 256,
                "gapX": gx // 256, "gapY": gy // 256,
            }
    return None


def parse_has0_tail(r, body):
    """Decode the hasSize==0 record tail (docs/xdat-tail-has0.md), or None.

    Layout: u8 0 | f32 f1 | f32 f2 | i32 A | i32 B | i32 C/D/E | u8 0 |
    i32 X | i32 Y | i32 m1 | i32 m2 | i32 0 | str "undefined" | i32 -9999.
    f1/f2 are the auto-size-to-parent toggles for width/height, A/B the
    right/bottom insets applied when enabled (see the doc for the rule).
    """
    d = r.d
    if body + 65 > len(d) or d[body] != 0:
        return None
    f1, f2 = struct.unpack_from("<ff", d, body + 1)
    if not (0.0 <= f1 <= 1.0 and 0.0 <= f2 <= 1.0):
        return None
    a, b, c_, d_, e_ = struct.unpack_from("<iiiii", d, body + 9)
    if not (0 < c_ < 10 and 0 < d_ < 10 and 0 < e_ < 10):
        return None
    if d[body + 29] != 0:
        return None
    x, y = struct.unpack_from("<ii", d, body + 30)
    m1, m2 = struct.unpack_from("<ii", d, body + 38)
    if m1 not in (-1, 0, 1) or m2 not in (-1, 0, 1):
        return None
    if r.i32(body + 46) != 0:
        return None
    got = r.string(body + 50)
    if not got or got[0] != "undefined":
        return None
    if r.i32(body + 61) != -9999:
        return None
    return {"x": x, "y": y, "autosize": (f1, f2), "insets": (a, b)}


def preceding_type(r, off):
    """The control's type is the string field ending exactly where it starts."""
    for back in range(2, 48):
        if off - back < 0:
            break
        got = r.string(off - back)
        if got and got[1] == off and got[0]:
            return got[0]
    return None


def scan(data):
    r = Reader(data)
    declared = struct.unpack_from("<I", data, 0)[0]

    records, o = [], 4
    while o < len(data) - 24:
        h = parse_header(r, o)
        if h:
            h["type"] = preceding_type(r, h["off"])
            records.append(h)
            o = h["body"]
        else:
            o += 1

    # Each record spans from its header to the start of the next one; harvest
    # the texture references that live in that span.
    for i, rec in enumerate(records):
        end = records[i + 1]["off"] if i + 1 < len(records) else len(data)
        rec["end"] = end
        # Try EVERY byte offset, not a walk. A walk has to advance by a fixed
        # stride wherever a string does not parse, and record bodies open with
        # int32s, so a 4-byte stride starts off the string lattice and steps
        # straight over anything that is not aligned to it. Measured on the
        # shipped Interface.xdat, that silently lost at least one texture in
        # 156 of 1,962 records — including every gauge FILL sprite
        # (ps_hpbar, ps_mpbar, ps_cpbar), which is why the status bars rendered
        # as flat coloured stripes: only the *_back empty plate survived, and
        # the port used the empty plate as the fill. A byte scan recovers 192
        # references, 133 of the 138 distinct names resolving to PNGs umodel
        # had already exported — chance would give ~0.
        refs = []
        for p in range(rec["body"], end):
            got = r.string(p)
            if got and got[0] and got[1] <= end and TEXREF.match(got[0]):
                refs.append(got[0])
        # preserve order, drop repeats
        rec["textures"] = list(dict.fromkeys(refs))

    return declared, records


data_g = b""


def build_tree(records):
    """Group records into windows -> flat child list (parent link is by name)."""
    windows, by_name = [], {}
    for rec in records:
        node = {
            "name": rec["name"],
            "type": rec["type"] or "Window",
            "width": rec["width"],
            "height": rec["height"],
            "x": rec["x"],
            "y": rec["y"],
            "textures": rec["textures"],
            "children": [],
        }
        if rec.get("autosize"):
            node["autosize"] = rec["autosize"]
            node["insets"] = rec["insets"]
        if rec["type"] == "ItemWindow":
            grid = parse_grid(Reader(data_g), rec["body"], rec["end"])
            if grid:
                node["grid"] = grid
        by_name.setdefault(rec["name"], node)
        if not rec["parent"]:
            node["type"] = rec["type"] or "Window"
            windows.append(node)
        else:
            parent = by_name.get(rec["parent"])
            (parent["children"] if parent else windows).append(node)
    return windows


def library_index():
    """Lowercased 'package/name' set of every PNG already exported."""
    have = set()
    if not os.path.isdir(LIBRARY):
        return have
    for pkg in os.listdir(LIBRARY):
        d = os.path.join(LIBRARY, pkg)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if f.lower().endswith(".png"):
                have.add(f"{pkg}/{os.path.splitext(f)[0]}".lower())
    return have


def resolve(ref, have):
    """'L2UI_CH3.ActionWnd.Action_Back' -> 'L2UI_CH3/Action_Back' if exported.

    umodel flattens texture groups, so only the package and the leaf name
    survive; the middle component is the in-package group.
    """
    parts = ref.split(".")
    cand = f"{parts[0]}/{parts[-1]}".lower()
    return cand if cand in have else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    ap.add_argument("--src", default=SRC)
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    if not os.path.exists(args.src):
        sys.exit(f"missing {args.src} — needs your own Interlude client")

    data = open(args.src, "rb").read()
    global data_g
    data_g = data
    declared, records = scan(data)
    windows = build_tree(records)

    tops = [r for r in records if not r["parent"]]
    covered = sum(r["end"] - r["off"] for r in records)

    have = library_index()
    refs = sorted({t for r in records for t in r["textures"]})

    # A dotted name is only a texture if it resolves in the library. The rest
    # are intra-UI references (a control pointing at another window/control,
    # e.g. ShortcutWnd.ShortcutWndVertical) — same syntax, different meaning.
    record_names = {r["name"] for r in records}
    resolved, control_refs, missing = {}, [], []
    for ref in refs:
        hit = resolve(ref, have)
        if hit:
            resolved[ref] = hit
        elif ref.split(".")[0] in record_names:
            control_refs.append(ref)
        else:
            missing.append(ref)
            resolved[ref] = None

    print(f"file            {len(data):,} bytes")
    print(f"records         {len(records):,}")
    print(f"top-level       {len(tops)} of {declared} declared")
    print(f"byte coverage   {covered / (len(data) - 4) * 100:.1f}%")
    print(f"dotted refs     {len(refs)} distinct — {len(resolved) - len(missing)} textures "
          f"resolved, {len(control_refs)} intra-UI control refs, {len(missing)} missing")

    types = {}
    for r in records:
        types[r["type"] or "Window"] = types.get(r["type"] or "Window", 0) + 1
    print("control types   " + ", ".join(
        f"{k}={v}" for k, v in sorted(types.items(), key=lambda kv: -kv[1])[:10]))

    if missing[:5]:
        print("missing tex e.g. " + ", ".join(missing[:5]))

    decoded = sum(1 for r in records if r["x"] is not None)
    menu = next((w for w in windows if w["name"] == "MenuWnd"), None)
    bands_tile = False
    if menu:
        bands = {c["name"]: c for c in menu["children"]
                 if c["name"].startswith("MenuWndBackTex")}
        if len(bands) == 3 and all(b["x"] is not None for b in bands.values()):
            ordered = sorted(bands.values(), key=lambda b: b["x"])
            bands_tile = all(
                a["x"] + a["width"] == b["x"]
                for a, b in zip(ordered, ordered[1:])) \
                and ordered[-1]["x"] + ordered[-1]["width"] == menu["width"]

    # hasSize==0 guards (docs/xdat-tail-has0.md): the four StatusWnd gauges
    # must stack in order at a constant pitch inside the window, and the
    # five ChatWnd panes must share one rect (tab alternates).
    def child(win, cname):
        w = next((w for w in windows if w["name"] == win), None)
        return next((c for c in (w["children"] if w else [])
                     if c["name"] == cname), None)
    has0_decoded = sum(1 for r in records
                       if r["width"] is None and r["x"] is not None)
    bars = [child("StatusWnd", n) for n in ("CPBar", "HPBar", "MPBar", "EXPBar")]
    bars_stack = all(b and b["x"] == 16 for b in bars) and \
        [b["y"] for b in bars] == [27, 41, 55, 69]
    panes = [child("ChatWnd", n) for n in
             ("NormalChat", "PartyChat", "ClanChat", "TradeChat", "AllyChat")]
    panes_tile = all(p and (p["x"], p["y"]) == (0, 0) for p in panes)
    print(f"coords decoded  {decoded:,} records (guard: >=1,600)")
    print(f"MenuWnd tiling  {'exact 173' if bands_tile else 'BROKEN'} (guard)")
    print(f"has0 decoded    {has0_decoded} of 200 (guard: >=170)")
    print(f"StatusWnd bars  {'stack 27/41/55/69' if bars_stack else 'BROKEN'} (guard)")
    print(f"ChatWnd panes   {'share rect' if panes_tile else 'BROKEN'} (guard)")

    # ItemWindow grid-param guards (docs/ui-mined-native.md §1b): every
    # standard grid must decode its 7-int block, and InventoryItem must be
    # exactly 4 rows / cap 250 / 32px cells / 5,3 gaps.
    grids = []
    def _walk(n):
        if n.get("grid"):
            grids.append(n)
        for c in n.get("children", []):
            _walk(c)
    for w in windows:
        _walk(w)
    inv = next((w for w in windows if w["name"] == "InventoryWnd"), None)
    inv_item = next((c for c in inv["children"] if c["name"] == "InventoryItem"), None) if inv else None
    grid_ok = (len(grids) >= 30 and inv_item and inv_item.get("grid")
               and inv_item["grid"]["rows"] == 4
               and inv_item["grid"]["capacity"] == 250
               and inv_item["grid"]["cellX"] == 32
               and inv_item["grid"]["gapX"] == 5
               and inv_item["grid"]["gapY"] == 3)
    print(f"grid decoded    {len(grids)} ItemWindow records (guard: >=30)")
    print(f"InventoryItem   {'4-row cap250 32px gap5,3' if grid_ok else 'BROKEN'} (guard)")
    ok = (len(tops) >= declared - 3
          and covered >= (len(data) - 4) * 0.95
          and not missing
          and decoded >= 1600
          and bands_tile
          and has0_decoded >= 170
          and bars_stack
          and panes_tile
          and grid_ok)
    if args.check:
        print("CHECK", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump({
            "source": "Interface.xdat",
            "declaredWindows": declared,
            "windows": windows,
            "textures": resolved,
            "controlRefs": sorted(control_refs),
        }, f, indent=1)
    print(f"wrote           {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
