#!/usr/bin/env python3
"""ElberaSkin (part 3) — the retail UI font, as a web bitmap font.

The Interlude client draws its UI with two bitmap fonts, SmallFont and
LargeFont. The glyph sheet is a texture inside the l2font packages; the
metrics live beside it in system/<name>.gly.

.gly format (reverse-engineered here, verified against the sheet dimensions):

  u32 texWidth
  u32 texHeight
  u32 pages
  u32 firstChar
  u32 charCount
  (u32 x, u32 width, u32 y, u32 height) * charCount
  <20 byte trailer>

The Latin (-e) variants cover firstChar=32, charCount=95 — printable ASCII —
on a single 1024x128 page, and are what the western client renders with. The
-r (Cyrillic, 256 glyphs over 2 pages) and the CJK sheets use a different
record layout and are NOT handled here; they are reported and skipped rather
than guessed at.

Verification: every glyph box must lie inside the sheet, and the declared
texture size must equal the actual PNG size. Both are asserted.

Usage:
  python3 tools/ui/build_font.py            # stage sheets + metrics
  python3 tools/ui/build_font.py --check    # verify, write nothing
"""

import argparse
import json
import os
import shutil
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SYSTEM = os.path.join(REPO, "assets/interlude/system")
LIBRARY = os.path.join(REPO, "assets/library")
STAGE = os.path.join(REPO, "editor/world/ui/font")
MANIFEST = os.path.join(REPO, "editor/world/ui/font.json")

# logical name -> (.gly in system/, sheet PNG in assets/library/)
FONTS = {
    "small": ("smallfont-e.gly", "L2Font-e/SmallFont-e.png"),
    "large": ("largefont-e.gly", "L2Font-e/LargeFont-e.png"),
}


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":   # SPEC: PNG (RFC 2083) signature
        raise ValueError(f"not a PNG: {path}")
    return struct.unpack(">II", head[16:24])


def parse_gly(path):
    d = open(path, "rb").read()
    tex_w, tex_h, pages, first, count = struct.unpack_from("<5I", d, 0)
    # SPEC: PNG (RFC 2083) -- an IHDR chunk is 8 bytes of header + 13 bytes
    # of data (rounded to the 20-byte prefix this reader skips), and each
    # glyph record that follows is a fixed 16 bytes.
    need = 20 + count * 16
    if len(d) < need:
        raise ValueError(f"{os.path.basename(path)}: truncated "
                         f"({len(d)} bytes, need {need})")
    glyphs = {}
    for i in range(count):
        x, w, y, h = struct.unpack_from("<4I", d, 20 + i * 16)
        glyphs[first + i] = {"x": x, "y": y, "w": w, "h": h}
    return {
        "texWidth": tex_w, "texHeight": tex_h, "pages": pages,
        "firstChar": first, "count": count, "glyphs": glyphs,
        "trailer": len(d) - need,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    out, failures = {}, []
    for name, (gly, sheet) in FONTS.items():
        gpath = os.path.join(SYSTEM, gly)
        spath = os.path.join(LIBRARY, sheet)
        if not os.path.exists(gpath) or not os.path.exists(spath):
            failures.append(f"{name}: missing {gly if not os.path.exists(gpath) else sheet}")
            continue

        f = parse_gly(gpath)
        sw, sh = png_size(spath)

        problems = []
        if (sw, sh) != (f["texWidth"], f["texHeight"]):
            problems.append(f"sheet is {sw}x{sh}, .gly declares "
                            f"{f['texWidth']}x{f['texHeight']}")
        if f["pages"] != 1:
            problems.append(f"{f['pages']} pages — multi-page layout not handled")
        oob = [c for c, g in f["glyphs"].items()
               if g["x"] + g["w"] > sw or g["y"] + g["h"] > sh]
        if oob:
            problems.append(f"{len(oob)} glyphs fall outside the sheet")

        line_h = max(g["h"] for g in f["glyphs"].values())
        status = "; ".join(problems) if problems else "ok"
        print(f"{name:<6} {gly:<18} {sw}x{sh}  chars {f['firstChar']}.."
              f"{f['firstChar'] + f['count'] - 1}  lineHeight {line_h}  {status}")
        if problems:
            failures.extend(f"{name}: {p}" for p in problems)
            continue

        out[name] = {
            "sheet": os.path.basename(sheet),
            "texWidth": sw, "texHeight": sh,
            "lineHeight": line_h,
            "firstChar": f["firstChar"],
            # compact: [x, y, w, h] per char, in code-point order from firstChar
            "glyphs": [[g["x"], g["y"], g["w"], g["h"]]
                       for _, g in sorted(f["glyphs"].items())],
        }

    if args.check:
        print("CHECK FAIL: " + "; ".join(failures) if failures else "CHECK PASS")
        return 1 if failures else 0
    if failures:
        sys.exit("refusing to stage: " + "; ".join(failures))

    os.makedirs(STAGE, exist_ok=True)
    for name, (_, sheet) in FONTS.items():
        if name in out:
            shutil.copy2(os.path.join(LIBRARY, sheet),
                         os.path.join(STAGE, os.path.basename(sheet)))
    with open(MANIFEST, "w") as fp:
        json.dump(out, fp, indent=1)
    print(f"wrote  {MANIFEST}  ({len(out)} fonts)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
