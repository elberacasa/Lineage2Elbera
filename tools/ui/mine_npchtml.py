#!/usr/bin/env python3
"""Mine the NPC dialog window (NpcHtmlMessage) out of NWindow.dll.

    python3 tools/ui/mine_npchtml.py            report
    python3 tools/ui/mine_npchtml.py --emit     write assets/gamedata/npchtml.json
    python3 tools/ui/mine_npchtml.py --check    re-verify, exit 1 on drift

WHY THIS EXISTS
---------------
The window a player sees when talking to an NPC is NOT in Interface.xdat.
`tools/xdat/parse_xdat.py` recovers 137 windows and none of them is it -- the
only two html windows the xdat declares are `HelpHtmlWnd` (310x311) and
`BoardWnd` (646x530), and `EventMatchGMCommandWnd` (310x401) is a GM tool that
happens to reuse the same background art.  `editor/world/js/ui/npcdialog.js`
read that absence as "no mined geometry exists" and authored a 360x420 box.

The geometry does exist.  It is in native code, because the window is a native
class: `NCNPCHtmlViewer`, constructed by the console at two fixed call sites
with a literal rect.  Everything below is an inline immediate on the
instruction that uses it, at an address this tool re-reads on --check.

NWindow.dll is a plain unpacked PE32, image base 0x10000000, FileAlignment ==
SectionAlignment == 0x1000, so **file offset == RVA** (asserted below; same
instrument as tools/ui/mine_native_colors.py).

EVIDENCE CHAIN
--------------
0. File offset == RVA.  `.?AVNCNPCHtmlViewer@@` is the RTTI type name; its
   TypeDescriptor is referenced by a COL whose vtable is 0x1024ef7c, and
   0x1024ef7c is written by exactly two functions (0x100899aa, 0x1008a005) --
   the class's two constructors.  Asserted.

1. THE WINDOW RECT, 0x1013fde7 and 0x1013fec5.  Two `NCNPCHtmlViewer`s are
   built by the console (retail can show two NPC pages at once).  Both
   allocate 0x1d4 bytes -- which is the size the class's own scalar-deleting
   destructor frees at 0x100899ef, so the allocation is this class -- run the
   ctor at 0x10089fd0, and then call vtable slot 0xc0 with:

       6a 05           push 5          ; vAlign mode
       6a 00           push 0          ; hAlign mode
       6a 01           push 1          ; anchored
       68 91 01 00 00  push 0x191      ; height 401
       68 36 01 00 00  push 0x136      ; width  310
       ...             push <y>        ; (parentHeight * 0.5) - 252.0
       6a 00 / push 0  push 0          ; x
                       call [edx+0xc0]

   Slot 0xc0 is SetWindowRect(x, y, w, h, anchored, hMode, vMode): its body at
   0x1005e8f0 stores arg1 -> this+0x80 (x), arg2 -> this+0x84 (y), and
   converts arg3/arg4 to float into this+0x88 / this+0x8c (w/h) at
   0x1005ea08 / 0x1005ea23.  Those two float fields are the same ones the
   window's own OnCreate reads back (item 2), which is what ties the pair
   together.

   The y expression is read from the two constants the site names:
   0x1022f270 = 0.5 (multiplied by the parent's height, this+0x8c) and
   0x1027ddd8 = 252.0 (subtracted).  hMode 0 is the absolute-left case of the
   jump table at 0x1005eadc; vMode 5 is the centre-relative case at
   0x1005eaf4[3], which stores (screenHeight/2 - y) so the window keeps its
   distance from the vertical centre across resolutions.

2. THE INTERIOR, NCNPCHtmlViewer::OnCreate 0x1008a030.  Two children, both
   through the same slot 0xc0:

     title bar   0x1008a0d7:  push 3 / push 0 / push 0 / push 0x14 / <width>
                              / push 0 / push 0     -> (0, 0, W, 20)
     html frame  0x1008a16d:  push 3 / push 0 / push 0
                              / <this.0x8c - [0x1024f738]>
                              / <this.0x88 - [0x1024f730]>
                              / push 0x1e / push 7  -> (7, 30, W-14, H-37)

   0x1024f730 = 14.0 and 0x1024f738 = 37.0 (IEEE doubles, read below).  With
   the rect from item 1 that is a frame of 296 x 364 at (7, 30) -- 7px left,
   7px right, 7px bottom, and 30 from the top of which 20 is the title bar.

3. THE BACKGROUND, 0x1013fe74.  OnCreate installs `L2UI.etcwnd.NPCHtml_BACK`
   into this+0x1d0 (0x1008a124), and the console OVERWRITES that slot at
   0x1013fe86 with the control it builds at 0x1013fe74 from
   `L2UI_ch3.NpcWnd.Npc1_back`.  So the art the player sees is Npc1_back,
   whose exported content rect is 310x381 -- the 401-tall window minus its
   20px title bar, exactly.

4. THE TAG TABLE, 0x1034e9a8.  A sorted array of 51 twelve-byte records
   {const wchar_t* name, const wchar_t** attrs, int attrCount}, walked by
   binary search.  This is the complete set of element names the client's
   HTML parser knows -- `DIV`, `SPAN`, `STRONG`, `EM`, `TH`, `TBODY` and
   `THEAD` are NOT in it, and `BR1`, `BAR`, `SPIN`, `VOLUMN`, `EXTEND`,
   `TEXTCODE`, `MULTIEDIT` and `COMBOBOX` are.

5. THE COLOURS.
     0x100856fa  push 0xffdcdcdc   -- body text, the not-a-link branch
     0x100856a3  mov eax,0xff6699ff-- link text, taken when the anchor's own
                                      colour (GetMatchedColor, item 6) is 0
     0x100856c9  push 0xff6699ff   -- the link's second colour argument,
                                      pushed unconditionally in that branch
   Both live in the tag draw that calls GetMatchedColor twice (0x100855eb,
   0x10085615), so they are the NPC-dialog text path and not some other
   window's.

6. `<font color=NAME>`, NCHtmlObject::GetMatchedColor 0x100825d0.  Already
   decoded by tools/ui/mine_native_colors.py section 5 and re-asserted here
   because this file's consumers need the WHOLE rule, not just the one name:

     - a NULL string returns 0 (0x10082609);
     - an exact wide compare against L"LEVEL" returns 0xffffcc00 (0x10082653);
     - anything else is concatenated after L"0xff" (0x1024dd38) and handed to
       wcstoul(str, NULL, 16) -- `push 0x10 / push 0 / push ebx /
       call 0x101c3629` at 0x10082705.

   The compare is case-SENSITIVE and the parse is wcstoul, so `color="white"`
   yields 0x000000ff (wcstoul stops at 'w') and `color="00FFFF"` yields
   0xff00ffff.  The word order is ARGB, not ABGR: LEVEL's own immediate is
   0xffffcc00 and retail's level tint is gold #FFCC00, which only reads
   correctly as A=ff R=ff G=cc B=00.

WHAT THIS TOOL DOES NOT DECODE
------------------------------
  * the font the html frame draws with.  `<body>` carries DEFFONT /
    DEFFIXEDFONT attributes, so the frame clearly has a default, but the
    default's NAME is not an immediate at any site read here.
  * the scrollbar's width and the frame's inner padding.
  * what `npc1_back_alpha01..22` are for.  They are 22 masks over the same
    310x381 art whose opaque band starts lower on each frame (measured: y=10
    on 01, 82 on 06, 172 on 11, 280 on 17), i.e. a wipe, and the base
    NCHtmlViewer ctor stores alpha01 at this+0x250 (0x10089ae8) -- but the
    code that steps through them was not located, so no timing is claimed.
Consumers must mark anything they need from those AUTHORED at the site.
"""

import argparse
import json
import os
import re
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DLL = os.path.join(REPO, "assets/interlude/system/NWindow.dll")
OUT = os.path.join(REPO, "assets/gamedata/npchtml.json")
BASE = 0x10000000

# Every address this tool reads. Named so --check can say which one drifted.
A_RECT_1 = 0x1013FDE7        # console builds NPC page 1
A_RECT_2 = 0x1013FEC5        # console builds NPC page 2
A_Y_EXPR = 0x1013FDF7        # fld [esi+0x8c] / fmul qword / fsub qword
A_BG_PUSH = 0x1013FE74       # push "L2UI_ch3.NpcWnd.Npc1_back"
A_TITLEBAR = 0x1008A0D7      # OnCreate: title-bar child
A_FRAME_TAIL = 0x1008A16D    # OnCreate: html-frame child, push 3/0/0
A_FRAME_XY = 0x1008A1C1      # OnCreate: html-frame child, push 0x1e / push 7
A_INSET_W = 0x1024F730       # double 14.0
A_INSET_H = 0x1024F738       # double 37.0
A_TAGS = 0x1034E9A8          # tag table, 51 x 12 bytes
A_ENTITIES = 0x1034EC10      # named character entities, flat pointer array
A_ALIGN = 0x1034ED30         # CENTER / RIGHT / LEFT / TOP / BOTTOM
ENTITY_COUNT = 67
A_TEXT_COLOR = 0x100856FA    # push 0xffdcdcdc
A_LINK_COLOR = 0x100856A3    # mov eax, 0xff6699ff
A_LINK_COLOR2 = 0x100856C9   # push 0xff6699ff
A_LEVEL = 0x10082653         # mov eax, 0xffffcc00
A_HEXPREFIX = 0x1024DD38     # L"0xff"
A_LEVELNAME = 0x1024DD44     # L"LEVEL"
A_WCSTOUL = 0x10082705       # push 0x10 / push 0 / push ebx / call
A_VTABLE_W1 = 0x100899AA     # mov [esi], 0x1024ef7c
A_VTABLE_W2 = 0x1008A005     # mov [esi], 0x1024ef7c
VTABLE = 0x1024EF7C
TAG_COUNT = 51


def read():
    with open(DLL, "rb") as f:
        return f.read()


def at(b, va, n):
    off = va - BASE
    return b[off:off + n]


def wstr(b, va, maxn=64):
    off = va - BASE
    out = []
    while off + 1 < len(b) and len(out) < maxn:
        c = b[off] | (b[off + 1] << 8)
        if c == 0:
            break
        if c < 0x20 or c > 0x7E:
            return None
        out.append(chr(c))
        off += 2
    return "".join(out)


def dword(b, va):
    return struct.unpack("<I", at(b, va, 4))[0]


def argb(v):
    return "#%06X" % (v & 0xFFFFFF)


def mine(b):
    """Every value, read from the instruction that uses it. Raises on drift."""
    fail = []

    def want(cond, what):
        if not cond:
            fail.append(what)

    # -- 0. the anchor: file offset == RVA, and the class is what we think ---
    td = b.find(b".?AVNCNPCHtmlViewer@@\x00")
    want(td > 0, "RTTI name .?AVNCNPCHtmlViewer@@ not in the image")
    want(dword(b, A_VTABLE_W1) == VTABLE and dword(b, A_VTABLE_W2) == VTABLE,
         "vtable 0x%08x is not written at 0x%08x/0x%08x" % (
             VTABLE, A_VTABLE_W1, A_VTABLE_W2))

    # -- 1. the window rect -------------------------------------------------
    # 6a 05  6a 00  6a 01  68 <h>  68 <w>
    rects = []
    for a in (A_RECT_1, A_RECT_2):
        s = at(b, a, 16)
        want(s[0:6] == b"\x6a\x05\x6a\x00\x6a\x01",
             "0x%08x: anchor/align push trio changed (%s)" % (a, s[0:6].hex(" ")))
        want(s[6] == 0x68 and s[11] == 0x68,
             "0x%08x: height/width are no longer imm32 pushes" % a)
        h = struct.unpack("<I", s[7:11])[0]
        w = struct.unpack("<I", s[12:16])[0]
        rects.append((w, h, s[5], s[3], s[1]))   # w, h, anchored, hMode, vMode
    want(rects[0] == rects[1],
         "the two NPC pages no longer share a rect: %r" % (rects,))
    width, height, anchored, h_mode, v_mode = rects[0]

    # y = parent.height * K1 - K2, with K1/K2 the doubles the site names
    y = at(b, A_Y_EXPR, 18)
    want(y[0:6] == b"\xd9\x86\x8c\x00\x00\x00",
         "0x%08x: y no longer starts from the parent's height field" % A_Y_EXPR)
    want(y[6:8] == b"\xdc\x0d" and y[12:14] == b"\xdc\x25",
         "0x%08x: y is no longer fmul-then-fsub" % A_Y_EXPR)
    k1_va = struct.unpack("<I", y[8:12])[0]
    k2_va = struct.unpack("<I", y[14:18])[0]
    k1 = struct.unpack("<d", at(b, k1_va, 8))[0]
    k2 = struct.unpack("<d", at(b, k2_va, 8))[0]

    # -- 2. the interior ----------------------------------------------------
    tb = at(b, A_TITLEBAR, 6)
    want(tb[0:4] == b"\x6a\x03\x53\x53" and tb[4] == 0x6A,
         "0x%08x: title-bar child no longer a push-imm8 height" % A_TITLEBAR)
    bar_h = tb[5]

    ft = at(b, A_FRAME_TAIL, 10)
    want(ft[0:4] == b"\x6a\x03\x53\x53",
         "0x%08x: html-frame tail pushes changed" % A_FRAME_TAIL)
    want(ft[4:10] == b"\xd9\x86\x8c\x00\x00\x00",
         "0x%08x: html frame no longer sized from the window's own height"
         % A_FRAME_TAIL)
    fx = at(b, A_FRAME_XY, 4)
    want(fx[0] == 0x6A and fx[2] == 0x6A,
         "0x%08x: html-frame x/y are no longer imm8 pushes" % A_FRAME_XY)
    frame_y, frame_x = fx[1], fx[3]
    inset_w = struct.unpack("<d", at(b, A_INSET_W, 8))[0]
    inset_h = struct.unpack("<d", at(b, A_INSET_H, 8))[0]

    # -- 3. the background --------------------------------------------------
    bg = at(b, A_BG_PUSH, 5)
    want(bg[0] == 0x68, "0x%08x: background is no longer a push imm32" % A_BG_PUSH)
    bg_ref = wstr(b, struct.unpack("<I", bg[1:5])[0])
    want(bg_ref is not None, "0x%08x: background push is not a wide string" % A_BG_PUSH)

    # -- 4. the tag table ---------------------------------------------------
    tags = {}
    va = A_TAGS
    for _ in range(TAG_COUNT):
        name = wstr(b, dword(b, va))
        if name is None:
            break
        p, cnt = dword(b, va + 4), dword(b, va + 8)
        attrs = []
        if p and 0 < cnt < 64:
            attrs = [wstr(b, dword(b, p + 4 * i)) for i in range(cnt)]
        tags[name] = [a for a in attrs if a]
        va += 12
    want(len(tags) == TAG_COUNT,
         "tag table at 0x%08x yielded %d records, expected %d"
         % (A_TAGS, len(tags), TAG_COUNT))
    want(sorted(tags) == list(tags),
         "tag table is no longer sorted -- the binary search would break")
    # spot checks that would catch a mis-aligned walk rather than a real change
    want(tags.get("A") == ["ACTION", "CMD", "HREF", "LINK", "MSG"],
         "A's attribute list changed: %r" % (tags.get("A"),))
    want(tags.get("BUTTON") == ["ACTION", "BACK", "FORE", "HEIGHT",
                                "VALUE", "WIDTH"],
         "BUTTON's attribute list changed: %r" % (tags.get("BUTTON"),))
    want("DIV" not in tags and "SPAN" not in tags and "TH" not in tags,
         "DIV/SPAN/TH appeared in the tag table")

    # -- 4b. named entities and the align keywords --------------------------
    entities = []
    va = A_ENTITIES
    while True:
        s = wstr(b, dword(b, va), 12)
        if not s or not s.isalpha():
            break
        entities.append(s)
        va += 4
    want(len(entities) == ENTITY_COUNT,
         "entity table at 0x%08x yielded %d names, expected %d"
         % (A_ENTITIES, len(entities), ENTITY_COUNT))
    want(sorted(entities) == entities, "entity table is no longer sorted")
    for must in ("amp", "gt", "lt", "nbsp", "quot"):
        want(must in entities, "&%s; vanished from the entity table" % must)
    want("apos" not in entities and "copy" not in entities,
         "the entity table grew names the Interlude client did not have")

    aligns = [wstr(b, dword(b, A_ALIGN + 4 * i)) for i in range(5)]
    want(aligns == ["CENTER", "RIGHT", "LEFT", "TOP", "BOTTOM"],
         "align keyword table at 0x%08x changed: %r" % (A_ALIGN, aligns))

    # -- 5/6. colours -------------------------------------------------------
    tc = at(b, A_TEXT_COLOR, 5)
    want(tc[0] == 0x68, "0x%08x: body-text colour is not a push imm32" % A_TEXT_COLOR)
    text_color = struct.unpack("<I", tc[1:5])[0]
    lc = at(b, A_LINK_COLOR, 5)
    want(lc[0] == 0xB8, "0x%08x: link colour is not mov eax,imm32" % A_LINK_COLOR)
    link_color = struct.unpack("<I", lc[1:5])[0]
    lc2 = at(b, A_LINK_COLOR2, 5)
    want(lc2[0] == 0x68 and struct.unpack("<I", lc2[1:5])[0] == link_color,
         "0x%08x: the link's second colour no longer matches the first"
         % A_LINK_COLOR2)
    lv = at(b, A_LEVEL, 5)
    want(lv[0] == 0xB8, "0x%08x: LEVEL colour is not mov eax,imm32" % A_LEVEL)
    level_color = struct.unpack("<I", lv[1:5])[0]
    want(wstr(b, A_LEVELNAME) == "LEVEL",
         "0x%08x is no longer L\"LEVEL\"" % A_LEVELNAME)
    want(wstr(b, A_HEXPREFIX) == "0xff",
         "0x%08x is no longer L\"0xff\"" % A_HEXPREFIX)
    wc = at(b, A_WCSTOUL, 4)
    want(wc[0:4] == b"\x6a\x10\x6a\x00",
         "0x%08x: the colour parse is no longer base-16 with a NULL end ptr"
         % A_WCSTOUL)

    if fail:
        raise SystemExit("DRIFT:\n  " + "\n  ".join(fail))

    frame_w = width - int(inset_w)
    frame_h = height - int(inset_h)
    return {
        "_note": "The retail NPC dialog window (NpcHtmlMessage). Interface.xdat "
                 "declares no such window -- it is a native class, and every "
                 "value here is an inline immediate at the address it names. "
                 "Re-verify with --check.",
        "_source": "assets/interlude/system/NWindow.dll",
        "_tool": "tools/ui/mine_npchtml.py",
        "window": {
            "width": width,
            "height": height,
            "titleBarHeight": bar_h,
            "background": bg_ref,
            "frame": {
                "x": frame_x, "y": frame_y,
                "width": frame_w, "height": frame_h,
                "insetWidth": int(inset_w), "insetHeight": int(inset_h),
            },
            "dock": {
                "x": 0,
                "yScale": k1,
                "yOffset": k2,
                "rule": "y = round(viewportHeight * %g - %g)" % (k1, k2),
                "anchored": anchored, "hMode": h_mode, "vMode": v_mode,
            },
            "evidence":
                "NWindow.dll 0x%08x and 0x%08x -- both NCNPCHtmlViewer instances "
                "(alloc 0x1d4, the size its own deleting dtor frees at "
                "0x100899ef; ctor 0x10089fd0 writes vtable 0x%08x) call "
                "SetWindowRect (vtable slot 0xc0, body 0x1005e8f0) with "
                "push 0x%x (h) / push 0x%x (w) / anchored=%d hMode=%d vMode=%d, "
                "y = parentHeight * %g - %g from the doubles at 0x%08x/0x%08x. "
                "Interior from NCNPCHtmlViewer::OnCreate 0x1008a030: title bar "
                "(0,0,W,%d) at 0x%08x, html frame (%d,%d,W-%d,H-%d) at "
                "0x%08x/0x%08x with the doubles at 0x%08x/0x%08x. Background "
                "control built at 0x%08x and stored over OnCreate's own "
                "L2UI.etcwnd.NPCHtml_BACK at 0x1013fe86."
                % (A_RECT_1, A_RECT_2, VTABLE, height, width, anchored, h_mode,
                   v_mode, k1, k2, k1_va, k2_va, bar_h, A_TITLEBAR, frame_x,
                   frame_y, int(inset_w), int(inset_h), A_FRAME_XY,
                   A_FRAME_TAIL, A_INSET_W, A_INSET_H, A_BG_PUSH),
        },
        "colors": {
            "text": argb(text_color),
            "link": argb(link_color),
            "level": argb(level_color),
            "evidence":
                "NWindow.dll 0x%08x push 0x%08x (body text, the not-a-link "
                "branch), 0x%08x mov eax,0x%08x (link text, taken when the "
                "anchor's own GetMatchedColor result is 0) with the same value "
                "pushed again at 0x%08x, and 0x%08x mov eax,0x%08x "
                "(NCHtmlObject::GetMatchedColor's only named colour)."
                % (A_TEXT_COLOR, text_color, A_LINK_COLOR, link_color,
                   A_LINK_COLOR2, A_LEVEL, level_color),
        },
        "colorRule": {
            "namedColor": "LEVEL",
            "hexPrefix": "0xff",
            "radix": 16,
            "byteOrder": "ARGB",
            "caseSensitive": True,
            "rule": "GetMatchedColor(s): s == NULL -> 0; wcscmp(s, L\"LEVEL\") "
                    "== 0 -> 0x%08x; else wcstoul(L\"0xff\" + s, NULL, 16)."
                    % level_color,
            "evidence":
                "NWindow.dll NCHtmlObject::GetMatchedColor 0x100825d0 -- null "
                "guard 0x10082609, wide compare against 0x%08x L\"LEVEL\" "
                "returning the immediate at 0x%08x, concatenation onto 0x%08x "
                "L\"0xff\" at 0x1008269d, and the base-16 parse "
                "(push 0x10 / push 0 / push ebx / call 0x101c3629) at 0x%08x. "
                "Byte order is ARGB because the one named colour's own "
                "immediate 0x%08x is retail's gold level tint."
                % (A_LEVELNAME, A_LEVEL, A_HEXPREFIX, A_WCSTOUL, level_color),
        },
        "entities": entities,
        "entitiesEvidence":
            "NWindow.dll 0x%08x -- a flat sorted array of %d wide names, the "
            "client's complete named-entity set. `apos` and `copy` are NOT in "
            "it, so &apos; and &copy; stay literal. No numeric-reference "
            "(&#nn;) path was located, and the shipped datapack uses none."
            % (A_ENTITIES, ENTITY_COUNT),
        "align": {"h": aligns[:3], "v": aligns[3:],
                  "evidence": "NWindow.dll 0x%08x -- the five alignment "
                              "keywords, h then v." % A_ALIGN},
        "tags": tags,
        "tagsEvidence":
            "NWindow.dll 0x%08x -- %d sorted 12-byte records "
            "{const wchar_t* name, const wchar_t** attrs, int attrCount}. "
            "This is the complete element-name table of the client's HTML "
            "parser; a name absent from it is the UNKNOWN case."
            % (A_TAGS, TAG_COUNT),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    if not os.path.exists(DLL):
        print("missing %s" % DLL)
        return 1
    b = read()
    doc = mine(b)

    w = doc["window"]
    print("window        %dx%d, title bar %d, background %s"
          % (w["width"], w["height"], w["titleBarHeight"], w["background"]))
    f = w["frame"]
    print("html frame    (%d,%d) %dx%d  (W-%d, H-%d)"
          % (f["x"], f["y"], f["width"], f["height"],
             f["insetWidth"], f["insetHeight"]))
    print("dock          x=%d, %s" % (w["dock"]["x"], w["dock"]["rule"]))
    c = doc["colors"]
    print("colours       text %s, link %s, LEVEL %s"
          % (c["text"], c["link"], c["level"]))
    print("tags          %d: %s" % (len(doc["tags"]), " ".join(sorted(doc["tags"]))))
    print("entities      %d named (&%s; .. &%s;)"
          % (len(doc["entities"]), doc["entities"][0], doc["entities"][-1]))

    if args.check:
        if not os.path.exists(args.out):
            print("CHECK FAIL (no %s -- run --emit)" % args.out)
            return 1
        on_disk = json.load(open(args.out, encoding="utf-8"))
        drift = [k for k in ("window", "colors", "colorRule", "tags",
                             "entities", "align")
                 if on_disk.get(k) != doc[k]]
        if drift:
            print("CHECK FAIL (on-disk json differs from the DLL: %s)"
                  % ", ".join(drift))
            return 1
        print("CHECK PASS")
        return 0

    if args.emit:
        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f2:
            json.dump(doc, f2, indent=1, ensure_ascii=False, sort_keys=True)
            f2.write("\n")
        print("wrote         %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
