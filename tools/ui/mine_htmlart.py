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
import glob
import json
import os
import re
import shutil
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools"))
LIBRARY = os.path.join(REPO, "assets/library")
PACKAGES = os.path.join(REPO, "assets/interlude")
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
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":   # SOURCED NWindow.dll
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
    if ct != 6:   # SOURCED NWindow.dll
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
        row = y * w * 4   # SOURCED NWindow.dll
        for x in range(w):
            if px[row + x * 4 + 3] > 4:      # SPEC: RGBA, +3 is alpha
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if maxx < 0:
        return None
    return (minx, miny, maxx - minx + 1, maxy - miny + 1)


# ---------------------------------------------------------------------------
# ALPHA REPAIR -- the staged PNG vs the client's own texture
# ---------------------------------------------------------------------------
# MEASURED 2026-08-09, and it is the reason this section exists.
#
# `assets/library/` is a umodel export tree, and umodel writes a PNG with NO
# alpha channel (IHDR colour type 2) for `L2UI.SquareBlank`. Decoding the same
# export straight out of `systextures/l2ui.utx` with this repo's own l2lib says
# the texture is DXT3 8x8 with the alpha block `00 00 00 00 00 00 00 00` --
# every texel alpha 0, i.e. FULLY TRANSPARENT. The staged PNG therefore drew it
# as OPAQUE BLACK.
#
# That is not cosmetic. `SquareBlank` is the datapack's spacer: 64 `<img
# src=...SquareBlank...>` in the shipped html (plus the Java-built pages) exist
# only to reserve vertical space, and several are 270px wide. Every one of them
# painted a black bar across an NPC page.
#
# The corroboration is in the package itself: `SquareBlack` is the SAME colour
# block with the alpha block `cc cc ...` (alpha 204). Two textures that differ
# only in alpha, named "Black" and "Blank". l2lib and umodel agree on
# SquareBlack; they disagree only where the whole alpha channel is zero.
#
# THE RULE APPLIED HERE, stated so it can be falsified: a staged PNG with no
# alpha channel has lost information IF AND ONLY IF the client's own texture,
# decoded from the .utx, carries an alpha that is not uniformly 255. In that
# case the PNG is rewritten from the l2lib decode. Nothing else is touched --
# an export that already carries alpha is left exactly as umodel wrote it, and
# a texture that really is opaque stays a 3-channel file.
#
# Across the 146 refs this tool stages, that rule fires on exactly one texture
# (SquareBlank, referenced under two spellings). `--check` asserts BOTH
# directions: the repaired file must be transparent, and every other staged
# PNG's alpha must still match the client's.

_PKG_INDEX = None
_PKG_CACHE = {}


def package_index():
    """package name (lower) -> .utx path, over the whole client tree."""
    global _PKG_INDEX
    if _PKG_INDEX is None:
        _PKG_INDEX = {}
        for p in glob.glob(os.path.join(PACKAGES, "**", "*.utx"), recursive=True):
            # SPEC: strip the 4-character extension ".utx" to get the package name
            _PKG_INDEX.setdefault(os.path.basename(p)[:-4].lower(), p)
    return _PKG_INDEX


def client_texture(ref):
    """(w, h, rgba_bytes) for a `Package.[Group.]Name` ref, or (None, reason).

    The decode is l2lib's, straight out of the client's own .utx -- the same
    parser docs/HANDOFF.md names for every other L2 format. It is used here as
    the arbiter over the umodel export, not as a replacement for it.
    """
    try:
        from l2lib import load_package, parse_texture, extract_texture_rgba  # noqa: F401
    except Exception as e:
        return None, "l2lib unavailable (%s)" % e
    parts = ref.split(".")
    pkgname, leaf = parts[0].lower(), parts[-1].lower()
    path = package_index().get(pkgname)
    if not path:
        return None, "no package %s in the client tree" % parts[0]
    if pkgname not in _PKG_CACHE:
        try:
            _PKG_CACHE[pkgname] = load_package(path)[0]
        except Exception as e:
            _PKG_CACHE[pkgname] = None
            return None, "package %s did not load (%s)" % (parts[0], e)
    pkg = _PKG_CACHE[pkgname]
    if pkg is None:
        return None, "package %s did not load" % parts[0]
    for e in pkg.exports_by_class("Texture"):
        if pkg.export_name(e).lower() == leaf:
            try:
                w, h, rgba, _info = extract_texture_rgba(pkg, e)
            except Exception as ex:
                return None, "%s did not decode (%s)" % (ref, ex)
            return (w, h, rgba), None
    return None, "package %s ships no texture %s" % (parts[0], parts[-1])


def staged_alpha(path):
    """(min, max) alpha of a staged PNG, or (255, 255) when it has no channel."""
    w, h, ct = png_head(path)
    if ct != 6:   # SPEC: PNG IHDR colour type -- 6 is RGBA, 2 is RGB
        return (255, 255)
    import contextlib
    import io
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from mine_atlas import png_read
    with contextlib.redirect_stdout(io.StringIO()):
        w, h, px = png_read(path)
    al = px[3::4]      # SPEC: PNG (RFC 2083) colour type 6 is RGBA, alpha at +3 of 4
    return (min(al), max(al))


def alpha_verdict(ref, staged_path):
    """Compare the staged PNG's alpha against the client's own texture.

    -> (verdict, detail).  verdict is one of
       'match'   the two agree (or the source could not be read -- detail says)
       'lost'    the export has no alpha channel and the client's is not opaque
       'differs' both carry alpha and they disagree
    """
    got, why = client_texture(ref)
    if not got:
        return "match", why
    w, h, rgba = got
    al = rgba[3::4]    # SPEC: l2lib returns RGBA8, alpha at byte +3 of every 4
    src = (min(al), max(al))
    _sw, _sh, ct = png_head(staged_path)
    have = staged_alpha(staged_path)
    if src == have:
        return "match", None
    if ct != 6 and src != (255, 255):   # SPEC: PNG colour type 6 is RGBA
        return "lost", {"clientAlpha": list(src), "stagedAlpha": list(have),
                        "size": [w, h]}
    return "differs", {"clientAlpha": list(src), "stagedAlpha": list(have),
                       "size": [w, h]}


def write_repaired(ref, out_path):
    """Rewrite `out_path` from l2lib's decode of the client's texture."""
    from l2lib import write_png
    got, why = client_texture(ref)
    if not got:
        raise SystemExit("cannot repair %s: %s" % (ref, why))
    w, h, rgba = got
    write_png(out_path, w, h, rgba)


_REPAIR_DIR = None


def _repair_dir():
    """Scratch for re-decoded PNGs; lives as long as the process."""
    global _REPAIR_DIR
    if _REPAIR_DIR is None:
        import tempfile
        _REPAIR_DIR = tempfile.mkdtemp(prefix="htmlart-repair-")
    return _REPAIR_DIR


# Sprites the html FRAME paints itself, named by NWindow.dll rather than by any
# server page or by Interface.xdat. Each is the operand of a `push imm32` at the
# address given, in NCScrollBar's own construction path -- verified by
# `--check`, which re-reads the DLL and fails if the string at that address is
# no longer this one. Without them the frame would have no scrollbar art at all
# and the port would have to draw a CSS one.
# SOURCED: every address below is a `push imm32` in NWindow.dll (image base
# 0x10000000, file offset == RVA), verified by native_refs_verified().
DLL = os.path.join(REPO, "assets/interlude/system/NWindow.dll")
NATIVE_REFS = {
    "L2UI_CH3.ScrollBar.ScrollBarUpBtn": 0x10095D27,
    "L2UI_CH3.ScrollBar.ScrollBarUpOnBtn": 0x10095D22,
    "L2UI_CH3.ScrollBar.ScrollBarDownBtn": 0x10095DDC,   # SOURCED NWindow.dll
    "L2UI_CH3.ScrollBar.ScrollBarDownOnBtn": 0x10095DD7,   # SOURCED NWindow.dll
    "L2UI_CH3.ScrollBar.SliderBarTop": 0x10095EC0,   # SOURCED NWindow.dll
    "L2UI_CH3.ScrollBar.SliderBarCenter": 0x10095EBB,   # SOURCED NWindow.dll
    "L2UI_CH3.ScrollBar.SliderBarBottom": 0x10095EB6,   # SOURCED NWindow.dll
    # NCNPCHtmlViewer::OnCreate 0x1008a124 installs this and the console
    # overwrites it at 0x1013fe86 -- staged so a reader can see both.
    "L2UI_ch3.NpcWnd.Npc1_back": 0x1013FE74,   # SOURCED NWindow.dll
    # THE <edit> CONTROL'S BACKGROUND, decoded 2026-08-09.
    #
    # MEASURED: 0x1009532c writes vtable 0x10251464 into [esi]; that vtable is
    # the one MSVC RTTI names `.?AVNCHtmlEdit@@` (its complete-object locator
    # points at the type descriptor whose name string is exactly that). So the
    # function containing 0x1009532c IS NCHtmlEdit's constructor. Eight bytes
    # later, at 0x10095346, it does `push 0x10251430` -- the wide string
    # L"L2UI.EtcWnd.Edit_Back" -- calls the same SetTexture helper 0x1003f630
    # that every other control in this image uses, and stores the handle at
    # this+0x350. It loads NO other texture.
    #
    # This settles an open question the wave brief had guessed at: the brief
    # expected `L2UI_CH3.Etc.inputbox1..3`. Those six names ARE in the image
    # (0x10234dc0 and neighbours) and ARE installed by a constructor -- but by
    # the one at 0x10095670, which also installs L2UI_CH3.ListCtrl.TextSelect
    # and is not NCHtmlEdit. An `<edit>` on an NPC page draws Edit_Back.
    #
    # The texture itself: l2ui.utx `Edit_Back`, DXT3 32x32, every texel alpha
    # 153 -- a flat translucent plate, which is why a 9-slice would be wrong.
    "L2UI.EtcWnd.Edit_Back": 0x10095346,   # SOURCED NWindow.dll
}

# THE <multiedit> CONTROL'S NINE-SLICE, decoded 2026-08-09.
#
# NCHtmlMultiEdit's vtable (0x10251214, named `.?AVNCHtmlMultiEdit@@` by its
# RTTI locator) carries 0x10095b50 in slot 0x98. That function is a LOOP:
#
#     0x10095b7b  mov  [esp+0x10], 9          ; nine iterations
#     0x10095b70  mov  ebx, 1                 ; %d starts at 1
#     0x10095b88  push 0x102518f8              ; L"l2ui_ch3.multiedit.M_inputbox0%d"
#     0x10095b98  push 0x102518a0              ; L"...M_inputbox0%d_disable"
#     0x10095bac/0x10095bc0 call 0x1003f630    ; the SetTexture helper
#     0x10095bc7  add  edi, 4                  ; handles into this+0x314..
#     0x10095bd2  jne  0x10095b83
#
# So the control is a THREE-BY-THREE nine-slice, and the names are the format
# string expanded over 1..9 -- not a literal, which is why they need their own
# table here. `--check` re-reads the format string itself and the loop's two
# immediates, so a change to either fails the gate.
NATIVE_FORMAT_REFS = {
    # push VA -> (format string at that VA, first, count)
    0x10095B88: ("l2ui_ch3.multiedit.M_inputbox0%d", 1, 9),
    0x10095B98: ("l2ui_ch3.multiedit.M_inputbox0%d_disable", 1, 9),
}
# The loop's own immediates, re-read by native_refs_verified().
FORMAT_LOOP_COUNT_VA = 0x10095B7B    # SOURCED NWindow.dll -- mov [esp+0x10], 9
FORMAT_LOOP_COUNT = 9                # SOURCED NWindow.dll
FORMAT_LOOP_FIRST_VA = 0x10095B70    # SOURCED NWindow.dll -- mov ebx, 1
FORMAT_LOOP_FIRST = 1                # SOURCED NWindow.dll
IMAGE_BASE = 0x10000000   # SOURCED: NWindow.dll's PE image base


def native_refs_verified():
    """Re-read each NATIVE_REFS address in NWindow.dll. Raises on drift."""
    if not os.path.exists(DLL):
        return dict(NATIVE_REFS), ["NWindow.dll absent -- refs taken on trust"]
    with open(DLL, "rb") as f:
        b = f.read()
    bad = []
    for ref, va in NATIVE_REFS.items():
        off = va - IMAGE_BASE
        if b[off] != 0x68:   # SOURCED NWindow.dll
            bad.append("0x%08x is not a push imm32" % va)
            continue
        sva = struct.unpack("<I", b[off + 1:off + 5])[0]
        o = sva - IMAGE_BASE
        out = []
        while o + 1 < len(b) and (b[o] or b[o + 1]):
            c = b[o] | (b[o + 1] << 8)
            if c < 0x20 or c > 0x7E:   # SOURCED NWindow.dll
                out = None
                break
            out.append(chr(c))
            o += 2   # SOURCED NWindow.dll
        got = "".join(out) if out else None
        if got != ref:
            bad.append("0x%08x pushes %r, expected %r" % (va, got, ref))

    out_refs = dict(NATIVE_REFS)

    # The nine-slice loop: verify the two loop immediates, then the format
    # string at each push, then expand it.
    def imm32_after(va, opcode_len):
        off = va - IMAGE_BASE
        return struct.unpack("<I", b[off + opcode_len:off + opcode_len + 4])[0]

    # 0x10095b7b is `C7 44 24 10 09 00 00 00` -- mov dword [esp+0x10], imm32.
    # SPEC: x86 `C7 /0 id` -- 4 opcode+modrm+sib bytes, then the imm32
    cnt = imm32_after(FORMAT_LOOP_COUNT_VA, 4)
    if cnt != FORMAT_LOOP_COUNT:
        bad.append("0x%08x: nine-slice loop count is %d, expected %d"
                   % (FORMAT_LOOP_COUNT_VA, cnt, FORMAT_LOOP_COUNT))
    # 0x10095b70 is `BB 01 00 00 00` -- mov ebx, imm32.
    first = imm32_after(FORMAT_LOOP_FIRST_VA, 1)
    if first != FORMAT_LOOP_FIRST:
        bad.append("0x%08x: nine-slice loop starts at %d, expected %d"
                   % (FORMAT_LOOP_FIRST_VA, first, FORMAT_LOOP_FIRST))

    for va, (fmt, lo, n) in NATIVE_FORMAT_REFS.items():
        off = va - IMAGE_BASE
        if b[off] != 0x68:   # SOURCED NWindow.dll
            bad.append("0x%08x is not a push imm32" % va)
            continue
        sva = struct.unpack("<I", b[off + 1:off + 5])[0]
        o = sva - IMAGE_BASE
        out = []
        while o + 1 < len(b) and (b[o] or b[o + 1]):
            c = b[o] | (b[o + 1] << 8)
            if c < 0x20 or c > 0x7E:   # SOURCED NWindow.dll
                out = None
                break
            out.append(chr(c))
            o += 2   # SOURCED NWindow.dll
        got = "".join(out) if out else None
        if got != fmt:
            bad.append("0x%08x pushes %r, expected the format %r"
                       % (va, got, fmt))
            continue
        for i in range(lo, lo + n):
            out_refs[fmt.replace("%d", str(i))] = va
    return out_refs, bad


def harvest():
    """Every texture ref named by server HTML, with where it came from."""
    refs = {}
    def scan(path, text):
        for m in REF_ATTR.finditer(text):
            raw = m.group(1) or m.group(2) or m.group(3) or ""   # SOURCED NWindow.dll
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
                idx[(pkg.lower(), fn[:-4].lower())] = os.path.join(pdir, fn)   # SOURCED NWindow.dll
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
    repaired = {}
    for ref in sorted(refs):
        path, why = resolve(ref, idx)
        if not path:
            missing[ref] = {"reason": why, "usedBy": sorted(refs[ref])[:3]}   # SOURCED NWindow.dll
            continue
        name = staged_name(ref)
        verdict, detail = alpha_verdict(ref, path)
        if verdict == "lost":
            # The umodel export dropped an alpha channel the client's own
            # texture carries. Re-decode from the .utx and stage THAT.
            path = os.path.join(_repair_dir(), name)
            write_repaired(ref, path)
            repaired[ref] = detail
        elif verdict == "differs":
            raise SystemExit(
                "%s: staged alpha %s but the client's texture decodes to %s -- "
                "this tool only knows how to repair a DROPPED channel, and this "
                "is a disagreement. Investigate before staging." % (
                    ref, detail["stagedAlpha"], detail["clientAlpha"]))
        w, h = png_size(path)
        rec = {"file": name, "w": w, "h": h}
        rect = content_rect(path)
        if rect:
            rec["cx"], rec["cy"], rec["cw"], rec["ch"] = rect
        if ref in repaired:
            rec["alphaRepaired"] = repaired[ref]
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

        # ALPHA GATE, both directions, against the files actually on disk in
        # editor/world/ui/htmlart. Every staged sprite's alpha extrema must
        # equal what l2lib reads out of the client's own .utx. This is what
        # went red on the pre-fix tree: L2UI.SquareBlank was staged opaque
        # (255,255) where the client's texture is (0,0).
        checked = 0
        bad = []
        for ref, rec in sorted(sprites.items()):
            got, _why = client_texture(ref)
            if not got:
                continue                      # source unreadable -- not a gate
            al = got[2][3::4]   # SPEC: RGBA8, alpha at +3 of every 4 bytes
            want = (min(al), max(al))
            have = staged_alpha(os.path.join(STAGE, rec["file"]))
            checked += 1
            if want != have:
                bad.append("%s: staged alpha %s, client texture %s"
                           % (ref, list(have), list(want)))
        if not checked:
            print("CHECK FAIL (the alpha gate evaluated ZERO sprites -- a gate "
                  "that asserts nothing is a failure, not a pass)")
            return 1
        if bad:
            print("CHECK FAIL (%d staged PNGs disagree with the client's own "
                  "texture alpha)" % len(bad))
            for line in bad[:8]:   # AUTHORED: how many lines of detail to print
                print("    " + line)
            return 1
        nrep = sum(1 for r in sprites.values() if "alphaRepaired" in r)
        print("alpha gate    %d sprites compared against the client's .utx, "
              "%d re-decoded" % (checked, nrep))
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
