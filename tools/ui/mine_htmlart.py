#!/usr/bin/env python3
"""Stage the textures NPC-dialog HTML names, straight out of the client packages.

    python3 tools/ui/mine_htmlart.py            report
    python3 tools/ui/mine_htmlart.py --emit     stage editor/world/ui/htmlart/
    python3 tools/ui/mine_htmlart.py --check    re-verify, exit 1 on drift

WHY THIS EXISTS
---------------
`tools/ui/build_uiskin.py` stages exactly the sprites Interface.xdat
references.  NPC dialog HTML references a DIFFERENT set, and it references
them by NAME AT RUNTIME:

    <button value="Enter" action="bypass -h ..."
            back="sek.cbui94" fore="sek.cbui92" width=80 height=25>
    <img src="L2UI.SquareWhite" width=280 height=1>

Those refs are in the SERVER's data, not in the client's UI definition, so no
xdat-driven staging can ever see them -- of the 141 distinct refs the shipped
datapack uses, the skin manifest carries 15.  The other 126 had nowhere to
come from, which is why the port drew CSS boxes where retail draws NCSoft's
own button art.

`<button>` has no fallback art in the client: NCHtmlButton's constructor
(NWindow.dll 0x10094ec0) forwards its two texture names straight to
NCButton::SetTexture (0x10006980) and supplies nothing when they are empty.
So a button whose art is missing is a button with NO art -- which makes
staging the real textures the only way to draw one.

WHAT IT DOES
------------
1. Harvests every `back=` / `fore=` / `src=` value out of the datapack's HTML
   and out of the gameserver sources that build HTML in Java.
2. Resolves each against assets/library/<package>/<name>.png, the umodel
   export tree (see docs/HANDOFF.md §3 step 1).  Resolution is
   case-insensitive and group-tolerant, because the client's own refs are:
   the same button appears as `L2UI_ch3.Btn1_normal`, `L2UI_CH3.Btn1_normal`
   and `l2ui_ch3.smallbutton2` across the datapack, and `Package.Name` with
   no group is the commonest form of all.
3. Stages the PNG and records its MEASURED content rect -- umodel pads every
   export to a power of two, so the file size is not the art size
   (sek.cbui94 is 96x24 of art inside a 128x32 file).
4. Records what it could NOT resolve, with the reason.  A ref naming a
   package the Interlude client does not ship (`L2UI_CT1` is Kamael-era) is
   not a bug to paper over -- the retail Interlude client would draw nothing
   there either, and the manifest says so instead of substituting art.

Nothing here is invented: a sprite is staged only if some server HTML names
it and the client actually ships it.
"""

import argparse
import json
import os
import re
import shutil
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIBRARY = os.path.join(REPO, "assets/library")
STAGE = os.path.join(REPO, "editor/world/ui/htmlart")
MANIFEST = os.path.join(REPO, "editor/world/ui/htmlart.json")
HTML_DIRS = [
    os.path.join(REPO, "server/aCis_datapack/data/html"),
    os.path.join(REPO, "server/aCis_datapack/data/scripts"),
]
JAVA_DIRS = [
    os.path.join(REPO, "server/aCis_gameserver/java"),
]

# `back="..."`, `fore='...'`, `src=Package.Name` -- quoted or bare, any case.
REF_ATTR = re.compile(
    r"""\b(?:back|fore|src)\s*=\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.\-]+))""",
    re.I)
# A texture reference is Package.Name or Package.Group.Name. Anything carrying
# a server template marker (%var%, <?x?>) is a runtime substitution, not a ref.
REF_SHAPE = re.compile(r"^[A-Za-z][A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+){1,3}$")


def png_head(path):
    """(width, height, colourType) straight out of the IHDR."""
    with open(path, "rb") as f:
        head = f.read(26)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise ValueError("not a PNG: %s" % path)
    w, h = struct.unpack(">II", head[16:24])
    return w, h, head[25]        # SPEC: PNG IHDR -- bit depth, then colour type


def png_size(path):
    w, h, _ct = png_head(path)
    return w, h


def content_rect(path):
    """Bounding box of non-transparent pixels, or None. Same measurement
    tools/ui/build_uiskin.py makes, and for the same reason."""
    w, h, ct = png_head(path)
    if ct != 6:
        # SPEC: PNG colour type 6 is RGBA; 2 is RGB with no alpha channel at
        # all. A sprite with no alpha has no transparent padding to strip, so
        # its content rect IS the file -- measured, not assumed.
        return (0, 0, w, h)
    import contextlib, io
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from mine_atlas import png_read
        with contextlib.redirect_stdout(io.StringIO()):
            w, h, px = png_read(path)
    except SystemExit:
        return None
    except Exception:
        return None
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        row = y * w * 4
        for x in range(w):
            if px[row + x * 4 + 3] > 4:      # SPEC: RGBA, +3 is alpha
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if maxx < 0:
        return None
    return (minx, miny, maxx - minx + 1, maxy - miny + 1)


# Sprites the html FRAME paints itself, named by NWindow.dll rather than by any
# server page or by Interface.xdat. Each is the operand of a `push imm32` at the
# address given, in NCScrollBar's own construction path -- verified by
# `--check`, which re-reads the DLL and fails if the string at that address is
# no longer this one. Without them the frame would have no scrollbar art at all
# and the port would have to draw a CSS one.
DLL = os.path.join(REPO, "assets/interlude/system/NWindow.dll")
NATIVE_REFS = {
    "L2UI_CH3.ScrollBar.ScrollBarUpBtn": 0x10095D27,
    "L2UI_CH3.ScrollBar.ScrollBarUpOnBtn": 0x10095D22,
    "L2UI_CH3.ScrollBar.ScrollBarDownBtn": 0x10095DDC,
    "L2UI_CH3.ScrollBar.ScrollBarDownOnBtn": 0x10095DD7,
    "L2UI_CH3.ScrollBar.SliderBarTop": 0x10095EC0,
    "L2UI_CH3.ScrollBar.SliderBarCenter": 0x10095EBB,
    "L2UI_CH3.ScrollBar.SliderBarBottom": 0x10095EB6,
    # NCNPCHtmlViewer::OnCreate 0x1008a124 installs this and the console
    # overwrites it at 0x1013fe86 -- staged so a reader can see both.
    "L2UI_ch3.NpcWnd.Npc1_back": 0x1013FE74,
}
IMAGE_BASE = 0x10000000


def native_refs_verified():
    """Re-read each NATIVE_REFS address in NWindow.dll. Raises on drift."""
    if not os.path.exists(DLL):
        return dict(NATIVE_REFS), ["NWindow.dll absent -- refs taken on trust"]
    with open(DLL, "rb") as f:
        b = f.read()
    bad = []
    for ref, va in NATIVE_REFS.items():
        off = va - IMAGE_BASE
        if b[off] != 0x68:
            bad.append("0x%08x is not a push imm32" % va)
            continue
        sva = struct.unpack("<I", b[off + 1:off + 5])[0]
        o = sva - IMAGE_BASE
        out = []
        while o + 1 < len(b) and (b[o] or b[o + 1]):
            c = b[o] | (b[o + 1] << 8)
            if c < 0x20 or c > 0x7E:
                out = None
                break
            out.append(chr(c))
            o += 2
        got = "".join(out) if out else None
        if got != ref:
            bad.append("0x%08x pushes %r, expected %r" % (va, got, ref))
    return dict(NATIVE_REFS), bad


def harvest():
    """Every texture ref named by server HTML, with where it came from."""
    refs = {}
    def scan(path, text):
        for m in REF_ATTR.finditer(text):
            raw = m.group(1) or m.group(2) or m.group(3) or ""
            raw = raw.strip()
            if not REF_SHAPE.match(raw):
                continue           # %template%, <?marker?>, empty, a filename
            refs.setdefault(raw, set()).add(os.path.relpath(path, REPO))

    for root_dir, exts in ((HTML_DIRS, (".htm", ".html")),
                           (JAVA_DIRS, (".java",))):
        for d in root_dir:
            if not os.path.isdir(d):
                continue
            for dirpath, _dirs, files in os.walk(d):
                for fn in files:
                    if not fn.lower().endswith(exts):
                        continue
                    p = os.path.join(dirpath, fn)
                    try:
                        with open(p, encoding="utf-8", errors="replace") as f:
                            scan(p, f.read())
                    except OSError:
                        pass
    return refs


def library_index():
    """(package_lower, leaf_lower) -> absolute PNG path."""
    idx = {}
    if not os.path.isdir(LIBRARY):
        return idx
    for pkg in os.listdir(LIBRARY):
        pdir = os.path.join(LIBRARY, pkg)
        if not os.path.isdir(pdir):
            continue
        for fn in os.listdir(pdir):
            if fn.lower().endswith(".png"):
                idx[(pkg.lower(), fn[:-4].lower())] = os.path.join(pdir, fn)
    return idx


def resolve(ref, idx):
    """A client texture ref -> the exported PNG, or (None, reason).

    The client looks a ref up as Package.[Group.]Name and its own data is not
    consistent about the group or the case, so both are ignored here: the
    package and the LEAF are what identify the texture in the export tree.
    """
    parts = ref.split(".")
    pkg, leaf = parts[0].lower(), parts[-1].lower()
    hit = idx.get((pkg, leaf))
    if hit:
        return hit, None
    if not any(k[0] == pkg for k in idx):
        return None, "package %s is not in the client's texture set" % parts[0]
    return None, "package %s ships no texture named %s" % (parts[0], parts[-1])


def staged_name(ref):
    parts = ref.split(".")
    return "%s__%s.png" % (parts[0], parts[-1])


def build():
    refs = harvest()
    native, native_bad = native_refs_verified()
    if native_bad:
        raise SystemExit("DRIFT in NWindow.dll native refs:\n  "
                         + "\n  ".join(native_bad))
    for ref, va in native.items():
        refs.setdefault(ref, set()).add("NWindow.dll 0x%08x" % va)
    idx = library_index()
    sprites, missing = {}, {}
    files = {}
    for ref in sorted(refs):
        path, why = resolve(ref, idx)
        if not path:
            missing[ref] = {"reason": why, "usedBy": sorted(refs[ref])[:3]}
            continue
        name = staged_name(ref)
        w, h = png_size(path)
        rec = {"file": name, "w": w, "h": h}
        rect = content_rect(path)
        if rect:
            rec["cx"], rec["cy"], rec["cw"], rec["ch"] = rect
        sprites[ref] = rec
        files[name] = path
    return sprites, missing, files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    sprites, missing, files = build()
    print("refs          %d resolved, %d unresolved"
          % (len(sprites), len(missing)))
    print("staged files  %d distinct PNGs" % len(files))
    by_pkg = {}
    for ref in missing:
        by_pkg.setdefault(ref.split(".")[0], 0)
        by_pkg[ref.split(".")[0]] += 1
    if by_pkg:
        print("unresolved    %s"
              % ", ".join("%s x%d" % (k, v) for k, v in sorted(by_pkg.items())))

    doc = {
        "_note": "Textures named by NPC-dialog HTML (back=/fore=/src=), staged "
                 "from the client's own packages. `missing` is honest: the "
                 "retail Interlude client draws nothing for those either.",
        "_source": "assets/library (umodel export) + server HTML",
        "_tool": "tools/ui/mine_htmlart.py",
        "sprites": sprites,
        "missing": missing,
    }

    if args.check:
        if not os.path.exists(MANIFEST):
            print("CHECK FAIL (no %s -- run --emit)" % MANIFEST)
            return 1
        on_disk = json.load(open(MANIFEST, encoding="utf-8"))
        if on_disk.get("sprites") != sprites:
            print("CHECK FAIL (manifest sprites differ from a fresh harvest)")
            return 1
        gone = [s["file"] for s in sprites.values()
                if not os.path.exists(os.path.join(STAGE, s["file"]))]
        if gone:
            print("CHECK FAIL (%d staged PNGs are missing, e.g. %s)"
                  % (len(gone), gone[0]))
            return 1
        print("CHECK PASS")
        return 0

    if args.emit:
        os.makedirs(STAGE, exist_ok=True)
        for name, src in files.items():
            shutil.copyfile(src, os.path.join(STAGE, name))
        with open(MANIFEST, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=1, sort_keys=True)
            f.write("\n")
        print("wrote         %s (+ %d PNGs in %s)"
              % (MANIFEST, len(files), STAGE))
    return 0


if __name__ == "__main__":
    sys.exit(main())
