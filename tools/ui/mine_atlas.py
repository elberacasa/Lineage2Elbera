#!/usr/bin/env python3
"""ElberaSkin (part 4) — recover sprite rects from an unreferenced atlas.

Some UI textures are sprite atlases that Interface.xdat never names: the
window's controls carry no texture reference at all, because the client's
native control paints from a hardcoded sub-rect. TargetStatusWnd is the case
that forced this tool -- its background and bars have empty texture lists,
and the art lives somewhere inside L2UI_CH3/npc1_back.png (310x381 of
content inside a 512x512 export).

Since the sub-rects are not in any data file we can read, recover them from
the pixels: sprite sheets separate their sprites with fully transparent
gutters, so recursively splitting the image on empty rows and columns
(a projection / guillotine split) recovers the packing.

Outputs a montage of every island found, plus a JSON of their rects, so a
human can identify which island is which and wire it up by index.

Usage:
  python3 tools/ui/mine_atlas.py L2UI_CH3/npc1_back
  python3 tools/ui/mine_atlas.py L2UI_CH3/npc1_back --min 6 --alpha 8
"""

import argparse
import json
import os
import struct
import sys
import zlib

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIBRARY = os.path.join(REPO, "assets/library")
OUT = os.path.join(REPO, "editor/world/ui/atlas")


# ---------------------------------------------------------------- png io

def png_read(path):
    # Everything in this reader is SPEC: PNG, RFC 2083 / W3C PNG 1.2 --
    # 8-byte signature, chunk = length + 4-char type + data + 4-byte CRC,
    # IHDR = width/height/bit-depth/colour-type, colour type 6 == RGBA so
    # 4 bytes per pixel with alpha at +3, and filter types 0..4
    # (None/Sub/Up/Average/Paeth) one byte per scanline. None of it is a
    # measurement of anything in the Lineage client.
    d = open(path, "rb").read()
    pos, idat = 8, b""   # SPEC: PNG (RFC 2083) signature is 8 bytes
    w = h = ct = None
    while pos < len(d):
        ln, typ = struct.unpack_from(">I4s", d, pos)
        pos += 8
        chunk = d[pos:pos + ln]
        pos += ln + 4
        if typ == b"IHDR":
            w, h, _bd, ct = struct.unpack(">IIBB", chunk[:10])
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
    if ct != 6:   # SPEC: PNG colour type 6 == truecolour with alpha
        raise SystemExit(f"{path}: expected RGBA (colour type 6), got {ct}")
    raw = zlib.decompress(idat)
    stride = w * 4   # SPEC: PNG colour type 6 == 4 bytes per pixel
    out, prev, o = bytearray(), bytearray(stride), 0
    for _ in range(h):
        ft = raw[o]; o += 1
        line = bytearray(raw[o:o + stride]); o += stride
        if ft:
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0   # SPEC: PNG filtering, 4 = bytes/pixel at colour type 6
                b = prev[i]
                c = prev[i - 4] if i >= 4 else 0   # SPEC: PNG filtering, 4 = bytes/pixel at colour type 6
                if ft == 1:
                    line[i] = (line[i] + a) & 255
                elif ft == 2:   # SPEC: PNG filter type 2 = Up
                    line[i] = (line[i] + b) & 255
                elif ft == 3:   # SPEC: PNG filter type 3 = Average
                    line[i] = (line[i] + (a + b) // 2) & 255
                elif ft == 4:   # SPEC: PNG filter type 4 = Paeth
                    pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                    pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    line[i] = (line[i] + pr) & 255
        out += line
        prev = line
    return w, h, bytes(out)


def png_write(path, w, h, px):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += px[y * w * 4:(y + 1) * w * 4]   # SPEC: PNG RGBA, 4 bytes/pixel

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 6)))
        f.write(chunk(b"IEND", b""))


# ------------------------------------------------------------- splitting

def split(px, w, x0, y0, x1, y1, alpha, min_size, depth=0):
    """Recursively guillotine-split a region on fully transparent gutters.

    SPEC: PNG colour type 6 -- the `* 4` strides and the `+ 3` alpha offset
    throughout this function are the RGBA layout, not chosen numbers.
    The recursion cap is AUTHORED (see below).
    """
    def row_empty(y):
        base = y * w * 4   # SPEC: PNG RGBA, 4 bytes/pixel
        return all(px[base + x * 4 + 3] <= alpha for x in range(x0, x1))   # SPEC: PNG RGBA, +3 is alpha

    def col_empty(x):
        return all(px[y * w * 4 + x * 4 + 3] <= alpha for y in range(y0, y1))   # SPEC: PNG RGBA, +3 is alpha

    # trim the region's own transparent margin
    while y0 < y1 and row_empty(y0): y0 += 1
    while y1 > y0 and row_empty(y1 - 1): y1 -= 1
    while x0 < x1 and col_empty(x0): x0 += 1
    while x1 > x0 and col_empty(x1 - 1): x1 -= 1
    if x1 - x0 < min_size or y1 - y0 < min_size:
        return []

    # AUTHORED recursion cap: deep enough that no shipped atlas hits it
    # (the deepest observed split is 7), shallow enough to bound the walk.
    if depth < 12:
        # horizontal gutters first, then vertical; alternate as we recurse
        bands, run = [], None
        for y in range(y0, y1):
            if row_empty(y):
                run = run if run is not None else y
            elif run is not None:
                bands.append((run, y)); run = None
        if bands:
            parts, cur = [], y0
            for a, b in bands:
                parts.append((cur, a)); cur = b
            parts.append((cur, y1))
            out = []
            for a, b in parts:
                if b - a >= min_size:
                    out += split(px, w, x0, a, x1, b, alpha, min_size, depth + 1)
            return out

        cols, run = [], None
        for x in range(x0, x1):
            if col_empty(x):
                run = run if run is not None else x
            elif run is not None:
                cols.append((run, x)); run = None
        if cols:
            parts, cur = [], x0
            for a, b in cols:
                parts.append((cur, a)); cur = b
            parts.append((cur, x1))
            out = []
            for a, b in parts:
                if b - a >= min_size:
                    out += split(px, w, a, y0, b, y1, alpha, min_size, depth + 1)
            return out

    return [(x0, y0, x1 - x0, y1 - y0)]


def crop(px, w, r):
    # SPEC: PNG colour type 6 -- 4 bytes per pixel.
    x, y, cw, ch = r
    out = bytearray()
    for row in range(y, y + ch):
        base = row * w * 4
        out += px[base + x * 4: base + (x + cw) * 4]   # SPEC: PNG RGBA, 4 bytes/pixel
    return bytes(out)


def montage(items, cols=6, pad=6):   # AUTHORED: debug contact sheet only
    """Grid of every island, each on a magenta plate so edges are visible.

    A DEBUG contact sheet, not a shipped asset: the column count, the padding
    and the plate colours are AUTHORED and affect nothing but this preview.
    The `* 4` / `+ 3` arithmetic is SPEC: PNG colour type 6 (RGBA).
    """
    cw = max(i["w"] for i in items) + pad * 2
    ch = max(i["h"] for i in items) + pad * 2
    rows = (len(items) + cols - 1) // cols
    W, H = cw * cols, ch * rows
    canvas = bytearray(W * H * 4)
    for idx, it in enumerate(items):
        cx, cy = (idx % cols) * cw, (idx // cols) * ch
        for y in range(ch):                      # plate
            for x in range(cw):
                o = ((cy + y) * W + cx + x) * 4   # SPEC: PNG RGBA, 4 bytes/pixel
                edge = x < 1 or y < 1 or x >= cw - 1 or y >= ch - 1
                canvas[o:o+4] = bytes((255, 0, 255, 255) if edge else (34, 34, 40, 255))
        ox, oy = cx + pad, cy + pad
        for y in range(it["h"]):                 # sprite, alpha-composited
            for x in range(it["w"]):
                s = (y * it["w"] + x) * 4   # SPEC: PNG RGBA, 4 bytes/pixel
                a = it["px"][s + 3]   # SPEC: PNG RGBA, +3 is alpha
                if not a:
                    continue
                o = ((oy + y) * W + ox + x) * 4   # SPEC: PNG RGBA, 4 bytes/pixel
                for c in range(3):
                    canvas[o + c] = (it["px"][s + c] * a + canvas[o + c] * (255 - a)) // 255
                canvas[o + 3] = 255   # SPEC: PNG RGBA, +3 is alpha
    return W, H, bytes(canvas)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("texture", help="e.g. L2UI_CH3/npc1_back")
    # AUTHORED defaults, all three: these are the knobs of a measuring
    # instrument, not values read out of the client. `--alpha 8` is what
    # counts as "transparent" when a texture's gutters carry a little
    # dithering; `--min 4` drops islands too small to be a control; `--cols`
    # only shapes the debug contact sheet.
    ap.add_argument("--alpha", type=int, default=8, help="gutter alpha threshold")
    ap.add_argument("--min", type=int, default=4, help="smallest island edge, px")   # AUTHORED instrument knob
    ap.add_argument("--cols", type=int, default=6)   # AUTHORED: debug contact sheet only
    args = ap.parse_args()

    src = os.path.join(LIBRARY, args.texture + ".png")
    if not os.path.exists(src):
        sys.exit(f"missing {src}")

    w, h, px = png_read(src)
    rects = split(px, w, 0, 0, w, h, args.alpha, args.min)
    rects.sort(key=lambda r: (r[1], r[0]))
    if not rects:
        sys.exit("no islands found — try --alpha 0 or a smaller --min")

    name = args.texture.replace("/", "__")
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))

    items = []
    print(f"{args.texture}: {w}x{h} -> {len(rects)} islands")
    for i, r in enumerate(rects):
        data = crop(px, w, r)
        png_write(os.path.join(d, f"{i:02d}.png"), r[2], r[3], data)
        items.append({"i": i, "x": r[0], "y": r[1], "w": r[2], "h": r[3], "px": data})
        print(f"  [{i:02d}]  x={r[0]:<4} y={r[1]:<4}  {r[2]}x{r[3]}")

    MW, MH, mpx = montage(items, cols=args.cols)
    png_write(os.path.join(d, "_montage.png"), MW, MH, mpx)
    with open(os.path.join(d, "index.json"), "w") as f:
        json.dump({"texture": args.texture, "source": [w, h],
                   "islands": [{k: it[k] for k in ("i", "x", "y", "w", "h")}
                               for it in items]}, f, indent=1)
    print(f"montage -> {os.path.relpath(os.path.join(d, '_montage.png'), REPO)} "
          f"({args.cols} cols, reading order)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
