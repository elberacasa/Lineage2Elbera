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
#
# Every dot-separated component must be at least 2 characters. That rule is
# what separates a real reference like `L2UI_CH3.SmallWnd.CpBar` from the two
# truncated authoring leftovers in the shipped file, `L2UI_CH3.d` and
# `l2UI_CH3.f`, which resolve to nothing.
#
# CORRECTED 2026-08-08. tools/ui/mine_texrefs.py's docstring says the byte-scan
# harvest "has since been folded into parse_xdat.py itself" and, in the same
# paragraph, that TEXREF "is tightened to require every dot-separated component
# to be at least 2 characters". The first half was true; the second was not —
# only the scan came across, and this pattern still read
# `(?:\.[A-Za-z0-9_\-]+){1,3}`. Nobody noticed because the checked-in
# interface.json had been generated back when the rule did hold, so the file on
# disk was right and the tool that regenerates it was not: a fresh run added
# `L2UI_CH3.d` and `l2UI_CH3.f` to TeaserSlideWnd and to the textures map.
# The two patterns are now the same rule, which is what mine_texrefs --check
# ("interface.json up to date") has been silently relying on.
TEXREF = re.compile(r"^[A-Za-z][A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]{2,}){1,3}$")

# Refs that are well-formed by the rule above but malformed in NCSoft's own
# shipped data — they name no texture in any package, in any client. Listing
# them explicitly is what lets --check gate on "no NEW unresolved ref" instead
# of "zero unresolved", which is the same contract tools/audio/build_audio.py
# uses for the 6 sound refs NCSoft shipped broken.
#
# default.black: the file also contains the correct `Default.BlackTexture`
# (which resolves to assets/library/default/BlackTexture.png). `default.black`
# is an authoring leftover of the same family as the truncated `L2UI_CH3.d`
# and `l2UI_CH3.f` — it simply survives the >=2-char component rule because
# "black" is five characters. There is no black.png in the default package.
KNOWN_UNRESOLVED = {"default.black"}


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


# docs: the TEXT block every TextBox record carries near the end of its span.
#
# The .uc scripts SetText() the dynamic boxes but never touch the static
# labels — DetailStatusWnd.uc writes txtSTR and txtPhysicalAttack and leaves
# txtHeadSTR / txtHeadPhysicalAttack alone — because those labels are stored
# in the record itself, as a SYSTEM-STRING ID resolved through
# sysstring-e.dat, followed by the box's text colour.
#
# Layout, verified byte-for-byte on DetailStatusWnd.txtHeadPhysicalAttack
# (body+78 onward) and unchanged across the file:
#
#     i32 -9999 | i32 textId (-9999 = none) | i32 -9999 | u8 B,G,R,A
#
# It is found by SIGNATURE, never at a fixed offset (the preceding fields are
# variable-length strings), and accepted only when the record's span contains
# EXACTLY ONE match — a second match would mean the shape is ambiguous there.
#
# Why this is not a guess, in four independent checks that all held:
#   * 650 of 658 TextBox records decode; every one of the 266 ids that come
#     out resolves in sysstring-e.dat, with zero misses.
#   * QuestTreeWnd's box is literally NAMED `txt324` and decodes to id 324
#     ('Accepted Quest') — the record labels itself.
#   * ClanWnd title0..3 decode to 1321/342/343/88 = 'Clan'/'Leader'/'Base'/
#     'Lv', which is what those four fields say in the retail window (the
#     port had been showing hand-translated Korean there).
#   * the colours that come out are #DCDCDC, #B09B79 and #A3A3A3 — the same
#     constants already mined independently out of NWindow.dll
#     (docs/ui-mined-native.md §2), alpha 255 on all 650.
#
# Button/CheckBox/ListCtrl tails do NOT match this shape and are left alone;
# their labels are still mined by hand (see js/ui/clanwnd.js).
TEXT_SIG = re.compile(rb"\xf1\xd8\xff\xff(.{4})\xf1\xd8\xff\xff(.{4})", re.S)

# The horizontal alignment enum, one int32 immediately after the box's default
# text. Two things are being claimed here and they are deliberately kept apart.
#
# MEASURED. Over the shipped file the field takes 1 on 430 boxes, 3 on 105 and
# 2 on 87, plus 0 on 24 and 4 on one. Nothing else.
#
# IDENTIFIED (inference, with what would falsify it). 2 = centre and 3 = right,
# from two cases where the layout admits only one answer:
#
#   * DetailStatusWnd's six gauge readouts (txtHP/MP/Exp/CP/Weight/SP, 85px
#     wide, sitting exactly on the 85px bars) all carry 2, and that case is
#     already settled from a different source: NWindow.dll's NCStatusBarCtrl
#     render CENTRES its label on the bar (`bar width * 0.5 - textWidth / 2`,
#     mined in js/ui/statuswnd.js). The same value is on txtCON, whose rect
#     (x 194, w 70) runs 8px past the window's 256px edge — centred the number
#     lands inside the window, right-aligned it would not.
#   * The eleven combat/social value boxes (49/50 wide, their label far to the
#     left) carry 3, and right is the only alignment that keeps those numbers
#     inside their column instead of walking into the next label.
#
#   Falsified by: a box carrying 2 or 3 whose text demonstrably cannot be
#   centred/right-aligned in its own rect. The per-control guards in main()
#   assert the DetailStatusWnd rows specifically.
#
# 1 = left is the residual, and only the residual — an earlier draft of this
# comment asserted that every 1 was a box with NO declared width, which is the
# kind of tidy story this file exists to distrust. It is false: 304 of the 430
# have a width. The guard that was written to enforce it failed immediately,
# which is the only reason the claim is not still sitting here.
#
# 0 (24 records) and 4 (1 record) are NOT identified and are not emitted.
ALIGN = {1: "left", 2: "center", 3: "right"}


UNDEFINED = b"\nundefined\x00"           # the serialized string, 11 bytes


def parse_text_block(r, body, end):
    """{'align', 'textId', 'color'} for a TextBox record, or None.

    The record tail ends in this fixed shape:

        i32 align | i32 f | str "undefined"
        | i32 -9999 | i32 textId | i32 -9999 | u8 B,G,R,A

    Found by SIGNATURE on the `-9999 <int> -9999 <colour>` run, never by a
    fixed offset, and accepted only on EXACTLY ONE match in the span. A walk
    forward from the record body was tried first and is what this replaces:
    it decoded 534 of 658 records because the fields ahead of the tail are
    variable-length and 124 records take a different route through them —
    the same phase problem that cost the texture harvest 156 records
    (tools/ui/mine_texrefs.py). The signature does not care how the record
    got there.

    `align` is then read BACKWARDS from the match, and only when the 11 bytes
    immediately before it are the literal serialized string "undefined" —
    which is what makes the backward read an anchored decode rather than an
    offset guess.
    """
    d = r.d
    span = d[body:end]
    hits = list(TEXT_SIG.finditer(span))
    if len(hits) != 1:
        return None
    m = hits[0]
    tid = struct.unpack("<i", m.group(1))[0]
    b, g, rr, a = m.group(2)
    if a != 255:
        return None
    out = {"color": f"#{rr:02X}{g:02X}{b:02X}"}
    if tid != -9999:
        out["textId"] = tid

    s = m.start()
    if s >= 19 and span[s - 11:s] == UNDEFINED:
        align = struct.unpack_from("<i", span, s - 19)[0]
        if align in ALIGN:
            out["align"] = ALIGN[align]
    return out


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
        if rec["type"] == "TextBox":
            txt = parse_text_block(Reader(data_g), rec["body"], rec["end"])
            if txt:
                node.update(txt)
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
        elif ref in KNOWN_UNRESOLVED:
            resolved[ref] = None
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

    # TextBox label guards (see parse_text_block): the block must decode for
    # nearly every TextBox, every id must resolve in sysstring-e.dat, and the
    # two records that NAME their own string id must decode to it.
    texts, labelled, aligned = [], [], []
    def _walk_text(n):
        if n["type"] == "TextBox" and n.get("color"):
            texts.append(n)
            if n.get("textId") is not None:
                labelled.append(n)
            if n.get("align"):
                aligned.append(n)
        for c in n.get("children", []):
            _walk_text(c)
    for w in windows:
        _walk_text(w)
    sysstr = os.path.join(REPO, "assets/gamedata/sysstring.json")
    ids_ok = True
    if os.path.exists(sysstr):
        known = {r["id"] for r in json.load(open(sysstr, encoding="utf-8"))}
        ids_ok = all(n["textId"] in known for n in labelled)
    # QuestTreeWnd.txt324 names its own id; DetailStatusWnd's stat labels are
    # the block this decode exists for.
    self_named = next((n for n in labelled if n["name"] == "txt324"), None)
    detail = {n["name"]: n.get("textId") for n in labelled}
    # Alignment guards (see ALIGN): the two DetailStatusWnd rows the
    # identification rests on. The gauge readouts are the row corroborated by
    # NCStatusBarCtrl; the combat values are the row where only right-align
    # fits the column.
    al = {n["name"]: n["align"] for n in aligned
          if n in [c for w in windows if w["name"] == "DetailStatusWnd"
                   for c in w["children"]]}
    align_ok = (len(aligned) >= 500
                and all(al.get(n) == "center" for n in
                        ("txtHP", "txtMP", "txtExp", "txtCP", "txtWeight", "txtSP"))
                and all(al.get(n) == "right" for n in
                        ("txtPhysicalAttack", "txtMagicDefense", "txtPVP"))
                and al.get("txtHeadSTR") == "left")
    text_ok = (len(texts) >= 640 and len(labelled) >= 260 and ids_ok
               and self_named is not None and self_named["textId"] == 324
               and detail.get("txtHeadSTR") == 104
               and detail.get("txtHeadPhysicalAttack") == 94
               and align_ok)
    print(f"TextBox labels  {len(texts)} decoded, {len(labelled)} carry a "
          f"sysstring id (guard: >=640 / >=260)")
    print(f"label ids       {'all resolve; txt324==324, STR==104' if ids_ok else 'BROKEN'} (guard)")
    print(f"text align      {len(aligned)} decoded; "
          f"{'gauges centre, values right, heads left' if align_ok else 'BROKEN'} (guard)")

    ok = (len(tops) >= declared - 3
          and covered >= (len(data) - 4) * 0.95
          and not missing
          and decoded >= 1600
          and bands_tile
          and has0_decoded >= 170
          and bars_stack
          and panes_tile
          and grid_ok
          and text_ok)
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
