#!/usr/bin/env python3
"""ElberaSkin (part 2) — assemble the browser UI skin from the retail art.

Reads the texture references decoded out of Interface.xdat, pulls the matching
PNGs out of assets/library/ (already exported by umodel), and stages them for
the web client together with a manifest carrying each sprite's true pixel size.

Nothing here invents art or geometry: a sprite is staged only if the xdat
actually references it and the PNG actually exists.

  --hd    additionally run each sprite through ElberaUpscaler (Real-ESRGAN
          4x, the same pass used on the character textures) and stage the
          upscaled copy. The manifest records both the source size and the
          staged scale, so the client lays out in retail pixels regardless.

Usage:
  python3 tools/ui/build_uiskin.py            # stage 1x
  python3 tools/ui/build_uiskin.py --hd       # stage 4x HD
  python3 tools/ui/build_uiskin.py --check    # verify, write nothing
"""

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INTERFACE = os.path.join(REPO, "assets/gamedata/interface.json")
LIBRARY = os.path.join(REPO, "assets/library")
STAGE = os.path.join(REPO, "editor/world/ui/skin")
MANIFEST = os.path.join(REPO, "editor/world/ui/skin.json")
UPSCALER = os.path.join(REPO, "tools/upscale/bin/realesrgan-ncnn-vulkan")
UPSCALER_MODELS = os.path.join(REPO, "tools/upscale/bin/models")


def png_size(path):
    """(width, height) straight out of the IHDR — no image library needed."""
    with open(path, "rb") as f:
        head = f.read(24)
    # SPEC: PNG (RFC 2083) -- 8-byte signature, then the first chunk, whose
    # 4-char type sits at offset 12 and must be IHDR.
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise ValueError(f"not a PNG: {path}")
    return struct.unpack(">II", head[16:24])


def content_rect(path):
    """Bounding box of non-transparent pixels: the sprite's REAL size.

    umodel pads every export to a power of two, so the file size is not the
    art size -- icon_back is 34x34 of cell inside a 64x64 PNG, and getting
    that wrong means guessing a grid pitch. Recording the measured rect here
    means no caller ever has to.

    Returns (x, y, w, h), or None when the decode is unsupported.
    """
    try:
        from mine_atlas import png_read
    except ImportError:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from mine_atlas import png_read
    try:
        w, h, px = png_read(path)
    except SystemExit:
        return None
    except Exception:
        return None
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        row = y * w * 4   # SPEC: RGBA, 4 bytes per pixel
        for x in range(w):
            # SPEC: RGBA -- +3 is the alpha byte. The > 4 threshold is
            # AUTHORED: what counts as "not transparent" when a sprite's
            # edge carries a dithered fringe.
            if px[row + x * 4 + 3] > 4:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if maxx < 0:
        return None
    return (minx, miny, maxx - minx + 1, maxy - miny + 1)


# Chrome the retail `Frame` control type paints implicitly. These sprites are
# real L2UI_CH3 art and the client draws them on every framed window, but the
# xdat never names them -- the control hardcodes them, so no texture reference
# appears in the file. Staged by explicit allowlist rather than left out.
IMPLICIT = [
    "L2UI_CH3.FrameCtrl.FrameBackLeft",
    "L2UI_CH3.FrameCtrl.FrameBackMid",
    "L2UI_CH3.FrameCtrl.FrameBackRight",
    "L2UI_CH3.FrameCtrl.FrameMiniBtn",
    "L2UI_CH3.FrameCtrl.FrameMiniOnBtn",
    # script-referenced, not in the xdat: PartyWnd.uc:393 sets the party
    # leader crown via SetTexture("L2UI_CH3.PartyWnd.party_leadericon")
    "L2UI_CH3.PartyWnd.party_leadericon",
    # AbnormalStatusWnd.uc:188 — every buff-strip icon draws on this back
    "L2UI.EtcWndBack.AbnormalBack",
    # ClanWnd.uc:1302/1308 — the member-list online/offline state icons
    "L2UI_CH3.BloodHoodWnd.BloodHood_Logon",
    "L2UI_CH3.BloodHoodWnd.BloodHood_Logoff",
]

# The 16 class icons (party_styleicon*) are native-referenced — GetClassIconName
# is a C++ thunk, so no script or xdat ever names them. The refs are mined from
# NWindow.dll into classicons.json by tools/ui/mine_classicons.py (tier 5);
# load them from there so this list never drifts from the DLL.
CLASSICONS = os.path.join(REPO, "assets/gamedata/classicons.json")
if os.path.exists(CLASSICONS):
    IMPLICIT += json.load(open(CLASSICONS)).get("icons", [])

# The item tooltip's nine-slice frame is native-referenced the same way: the
# only place `L2UI_CH3.Tooltip.Tooltip%d` appears is inside NWindow.dll
# (NCTooltip's ctor, literal at 0x10256a74), and NCTooltip::DrawTooltip
# 0x10054680 paints the nine handles row-major. tools/ui/mine_itemtooltip.py
# decodes that and writes the expanded refs, so this list cannot drift from
# the DLL either.
ITEMTOOLTIP = os.path.join(REPO, "assets/gamedata/itemtooltip.json")
if os.path.exists(ITEMTOOLTIP):
    IMPLICIT += json.load(open(ITEMTOOLTIP))["window"]["textureRefs"]

# The five grade badges the tooltip draws after the item name.
#
# HALF DECODED, HALF AUTHORED — read this before trusting it.
#   DECODED: GetItemGradeString returns the literal names "graded" "gradec"
#   "gradeb" "gradea" "grades" (NWindow.dll table 0x10350f70);
#   AddTooltipItemGrade wraps them in backticks (Tooltip.uc:1887); the layout
#   pass recognises exactly `Len==8, Mid(1,6) in that table` and gives the run
#   a 12x12 box (NWindow.dll 0x10146430 / 0x100656ee).
#   AUTHORED: which TEXTURE each name resolves to. `graded` is not an object
#   name in ANY shipped .utx (checked all of systextures/ with umodel), the
#   string appears nowhere outside NWindow.dll's own table, and the routine
#   that turns a backtick run into a sprite is in Engine.dll, which is
#   THEMIDA-packed (docs/HANDOFF.md §5). The mapping below is the obvious
#   letter match against symbol.utx's five grade badges and nothing more.
#   It would be falsified by finding the resolver and seeing a different
#   package/group, or by a badge that draws at other than 12x12.
IMPLICIT += ["symbol.Icon.grade_d", "symbol.Icon.grade_c", "symbol.Icon.grade_b",
             "symbol.Icon.grade_a", "symbol.Icon.grade_s"]


def staged_name(ref):
    """'L2UI_CH3.ChatWnd.Back' -> 'L2UI_CH3__Back' (flat, collision-free)."""
    parts = ref.split(".")
    return f"{parts[0]}__{parts[-1]}"


def collect(doc):
    """ref -> absolute source PNG, for every reference that resolves."""
    out = {}
    for ref, rel in doc["textures"].items():
        if not rel:
            continue
        # the manifest stores a lowercased 'package/name'; find the real path
        pkg, name = rel.split("/", 1)
        for cand_pkg in os.listdir(LIBRARY):
            if cand_pkg.lower() != pkg:
                continue
            d = os.path.join(LIBRARY, cand_pkg)
            for f in os.listdir(d):
                if f.lower() == name + ".png":
                    out[ref] = os.path.join(d, f)
                    break
            break

    for ref in IMPLICIT:
        pkg, leaf = ref.split(".")[0], ref.split(".")[-1]
        cand = os.path.join(LIBRARY, pkg, leaf + ".png")
        if not os.path.exists(cand):
            # umodel exports the object's own name, whose case need not match
            # the reference's -- L2UI_CH3.Tooltip.Tooltip1 is on disk as
            # L2UI_CH3/tooltip1.png. The xdat branch above already resolves
            # case-insensitively; this makes the implicit branch agree instead
            # of silently depending on a case-insensitive filesystem.
            cand = None
            for cand_pkg in os.listdir(LIBRARY):
                if cand_pkg.lower() != pkg.lower():
                    continue
                d = os.path.join(LIBRARY, cand_pkg)
                for f in os.listdir(d):
                    if f.lower() == leaf.lower() + ".png":
                        cand = os.path.join(d, f)
                        break
                break
        if cand:
            out[ref] = cand
        else:
            print(f"  warn: implicit chrome {ref} not in the library")
    return out


def upscale_all(sources, dest):
    """Run Real-ESRGAN 4x over a directory of PNGs (alpha preserved)."""
    if not os.path.exists(UPSCALER):
        sys.exit(f"missing {UPSCALER} — run tools/build-tools.sh, or drop --hd")
    with tempfile.TemporaryDirectory() as tmp_in:
        for ref, src in sources.items():
            shutil.copy2(src, os.path.join(tmp_in, staged_name(ref) + ".png"))
        subprocess.run(
            [UPSCALER, "-i", tmp_in, "-o", dest, "-s", "4",
             "-m", UPSCALER_MODELS, "-f", "png"],
            check=True,
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hd", action="store_true", help="stage 4x upscaled sprites")
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()

    if not os.path.exists(INTERFACE):
        sys.exit("missing assets/gamedata/interface.json — run tools/xdat/parse_xdat.py")

    doc = json.load(open(INTERFACE))
    refs = doc["textures"]
    sources = collect(doc)

    unresolved = [r for r, v in refs.items() if not v]
    lost = [r for r, v in refs.items() if v and r not in sources]

    print(f"references      {len(refs)}")
    print(f"staged          {len(sources)}")
    print(f"unresolved      {len(unresolved)} (referenced by the xdat, not in the library)")
    if lost:
        print(f"MISSING FILE    {len(lost)}: {lost[:4]}")

    if args.check:
        ok = not lost and len(sources) > 0
        print("CHECK", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    # 4x is the upscale factor the HD pass bakes (see --hd); it matches the
    # character pipeline's own 4x, not a number chosen here.
    # 4x matches the character pipeline's own HD factor (docs/character-
    # pipeline.md); the sprites are upscaled by the same amount so Skin.px
    # keeps one scale for the whole UI.
    # AUTHORED 4x: nothing in the client asks for an upscale at all -- the
    # HD pass is ours. 4 matches what the character pipeline already bakes,
    # so Skin.px keeps a single scale across the whole UI.
    scale = 4 if args.hd else 1
    os.makedirs(STAGE, exist_ok=True)
    for f in os.listdir(STAGE):
        os.remove(os.path.join(STAGE, f))

    if args.hd:
        print(f"upscaling {len(sources)} sprites 4x — this takes a while…")
        upscale_all(sources, STAGE)
    else:
        for ref, src in sources.items():
            shutil.copy2(src, os.path.join(STAGE, staged_name(ref) + ".png"))

    manifest = {}
    for ref, src in sources.items():
        f = staged_name(ref) + ".png"
        sw, sh = png_size(src)
        staged = os.path.join(STAGE, f)
        if not os.path.exists(staged):
            print(f"  warn: {ref} did not survive staging")
            continue
        dw, dh = png_size(staged)
        rec = {
            "file": f,
            "w": sw, "h": sh,               # the exported (padded) size
            "scale": round(dw / sw) if sw else 1,
        }
        cr = content_rect(src)
        if cr:
            # measured art rect inside the padded export
            rec["cx"], rec["cy"], rec["cw"], rec["ch"] = cr
        manifest[ref] = rec

    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w") as fp:
        json.dump({"scale": scale, "sprites": manifest}, fp, indent=1)

    total = sum(os.path.getsize(os.path.join(STAGE, s["file"])) for s in manifest.values())
    print(f"wrote           {MANIFEST}  ({len(manifest)} sprites, {total/1e6:.1f} MB at {scale}x)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
