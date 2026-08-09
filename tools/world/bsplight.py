#!/usr/bin/env python3
"""bsplight.py - the retail BAKED LIGHTMAPS of the level BSP, decoded.

WHAT THIS IS AND WHAT IT REPLACES

`tools/world/lightmap.py` decoded the first region of the level UModel's
tail (the render section table) and stopped, recording the rest as

    "region B ... 1.47 MB ... where the baked lighting lives, and it is NOT
     decoded. What is missing before any of it can be drawn: which surface
     each record belongs to, the atlas the masks composite into, and the
     light colour / attenuation each mask is multiplied by."

All three of those are decoded here, and the "atlas the masks composite
into" turned out to be already baked and sitting in the same tail: eight
512x512 DXT1 images per tile. Nothing in this file computes lighting.
There is no ambient-occlusion bake, no vertex-colour stand-in and no
screen-space effect anywhere in the pipeline this feeds; every texel the
client shows is a texel S3TC-decompressed out of the retail .unr.

REGION B, EXACTLY (offsets are 22_22 unless stated)

    cidx N                       595 on 22_22, 272 on 17_25, 1888 on 20_21
    u8   (0 on every tile)        <- unexplained, see KNOWN GAPS
    N x FLightMap record:
        cidx iSurf               index into Model.Surfs
        cidx Q                   <- unexplained, see KNOWN GAPS
        cidx X, cidx Y           the record's top-left texel in its sheet
        cidx W, cidx H           its size in texels
        25 x f32                 see "THE 25 FLOATS" below
        cidx NumMasks
        NumMasks x shadow mask:
            cidx  iLight
            cidx  Len
            byte[Len]            ONE BIT PER TEXEL, rows padded to bytes
            i32   W, H, RowBytes, PadU, PadV, UClamp, VClamp
        cidx Tag                 a PER-TILE CONSTANT, see "THE TAG" below
        5 bytes                  <- read by length, unexplained, see GAP 3
    atlas SHEETS until the export ends; per sheet:
        cidx Variants            1 or 8 on every tile measured
        Variants x:
            cidx Tag             the SAME per-tile constant as the record's
            cidx M, M x i32      record indices; the FIRST of a sheet's
                                 arrays is its membership list and the
                                 sheets partition 0..N-1 in order
            i32  Header[3]       [0]: page 0 of each sheet forms one
                                 512-step run; 1..7 sit outside it (1b)
            2 x mip:
                i32  SkipPos     absolute offset of the byte after Data
                cidx DataCount   131072 then 32768
                byte[DataCount]  DXT1: 512x512 then 256x256
            13 bytes             page footer, always starting
                                 03 00 02 00 00 00 02 00 00  (see GAP 3)
        cidx M, M x i32          the sheet's trailing array, no Tag

THE TAG, and why 21_14 used to be the one tile that did not decode

This file used to read the record's trailer as a FIXED SIX BYTES and the
per-page field as a `u8 Sep`. Both were correct measurements welded to an
unexamined inference -- the inference being the WIDTH. Both fields are one
and the same COMPACT INDEX, and a compact index is one byte only while its
value is under 64.

  * per tile, the set of values the record trailer opens with and the set
    of values the pages carry are the SAME ONE-ELEMENT SET on 96 of the 96
    tiles that carry records at all (the other four carry none). It is one
    constant per tile: 22_22 4, 17_21 5, 17_25 12, 23_17 34, 21_14 156.
  * 21_14's value is 156. That is the ONLY tile in the world set whose
    value exceeds 63, so it is the only tile where the field needs two
    bytes -- and it was the only tile that did not decode. Reading it as
    one byte cost one byte in every record and one byte in every page, and
    the sheet loop then read its `cidx Variants` out of the middle of the
    previous field and got 0.
  * with the field read as a compact index in BOTH places, region B walks
    to the byte on 100 of 100 tiles under every invariant listed below,
    21_14 included. Reading it as a fixed 6 / u8 pair walks 99. No other
    split of those bytes reaches 100: `cidx,cidx,i32` walks 97 and six
    compact indices walks 78 (both measured over the same 100 tiles).
  * what the constant MEANS is not established. It is not the light count,
    the distinct-iLight count, max(iLight), the sheet count or the record
    count -- all five were checked against all 96 tiles and none matches.
    It is recorded as `tag` and pinned by --check, not named.

  What 21_14 gains from the fix is a decode, and NOT a pixel. Its two
  lightmap records are surfaces 79 and 80, and both resolve through the
  import table to FX_E_T.WaterShader01 -- the water plane the client
  already draws from scene.json's `water`, which tools/world/bsp.py drops
  from the BSP on purpose (WATER_MATERIAL). So 21_14's bsp.gltf carries
  zero lightmapped materials before the fix and zero after it. The tile is
  no longer a hole in the decode; it never was a hole in the picture.

WHY EACH NAME IS A MEASUREMENT AND NOT A GUESS

  * the grammar itself. Parsing it consumes region B to the byte on 100 of
    the 100 converted tiles: the walk
    ends exactly on the export's last byte, every shadow mask satisfies
    Len == RowBytes * H, RowBytes == ceil(W/8), UClamp == W+PadU-1 and
    VClamp == H+PadV-1, every mask fits inside its record's rectangle,
    every sheet's arrays agree on M, the sheets' membership lists partition
    0..N-1 with no gap or overlap, and every SkipPos lands exactly on the
    byte after its mip. A desync cannot survive that.
  * one sheet, several variants -- not several sheets. Inside a sheet the
    record rectangles never overlap: sum(W*H) equals the number of distinct
    occupied texels EXACTLY on every sheet of every tile checked (22_22
    71,168; 20_21's nine sheets 185,664 / 159,040 / 194,688 / 193,088 /
    209,920 / 202,816 / 173,056 / 187,776 / 159,680). If the variants were
    different sheets the rectangles would be free to collide, and over
    45,006 records not one pair does.
  * `iSurf`. Its range is 0 .. len(Surfs)-1 on every tile and never one
    over (22_22 6..1090 of 1091 surfs; 17_25 37..457 of 458; 20_21
    1..1775 of 1776). It is also consistent with the node link below: the
    nodes that point at a record all share that record's surface.
  * `X, Y, W, H`. max(X+W) == 512 and max(Y+H) <= 512 on every tile, i.e.
    the records pack into a 512x512 sheet -- which is exactly the size the
    DXT1 mip 0 turns out to be (131072 bytes = 512*512/2).
  * the link from geometry. FBspNode's third trailing i32 (`i_light_map`,
    previously read and discarded) is -1 or an index into this array, and
    its maximum is exactly N-1 on every tile.
  * the lighting model that falls out of it. A drawn node either carries a
    lightmap or its surface carries PF_UNLIT: over all 100 tiles
    only TWELVE drawn nodes are neither (4 on 20_22, 2 on 24_15, 6 on
    25_12, all PolyFlags 0), and those twelve are pinned in
    UNLIT_UNFLAGGED. That is why the client can drop the dynamic light on
    the BSP entirely instead of inventing one.
  * the UVs. The 40-byte render vertex's bytes 20..27 were written up as
    "NOT identified ... this tool records the bytes and refuses to name
    them". Tested against the rectangles decoded here they are the lightmap
    UVs: (u*512, v*512) lands inside the vertex's OWN record rectangle on
    5021/5021 (22_22), 3100/3100 (17_25), 18599/18599 (20_21) and 3156/3156
    (20_16) vertices -- 100.00%, zero outside, zero NaN. The earlier NaN /
    out-of-[0,1] readings were all on nodes with i_light_map == -1.
  * DXT1. Decoding mip 0 as DXT1 produces a picture of packed rectangles
    whose occupied area is exactly the union of the record rectangles
    (22_22: 71,168 texels, 27.1% of the sheet) and whose content is
    recognisable town lighting. No other block format lays out that way.

THE 25 FLOATS (partly identified, and only what is checked is named)

    f0..f2    the surface normal: equals the node plane's normal
    f4..f6    a vector along the lightmap U axis
    f8..f10   a vector along the lightmap V axis
    f16..f18  an FVector in tile world space, inside the tile's box
    f21       1 / |f8..f10|      (0.66667 vs 1.5, 20.333 vs 0.0491803)
    f23       1 / f4..f6's non-zero component, sign included
  The rest are recorded verbatim and NOT named. The client does not need
  them: it uses the render vertices' own lightmap UVs, which are retail
  data and need no reconstruction.

KNOWN GAPS - none of these blocks the lightmaps, and none is papered over

  1. WHAT SELECTS a variant at runtime is still NOT sourced. What the
     default IS, however, is no longer an arbitrary pick -- see "VARIANT 0
     IS THE PRIMARY" below. Two claims that used to stand in this gap were
     wrong and are corrected there.

     A sheet carries 1 or 8 variants; all 8 share one rectangle layout
     (same records, same X/Y/W/H) and differ only in colour. 22_22's
     per-variant mean over the used texels runs
        p0 (62.5,65.5,68.4)  p1 (62.0,65.1,67.9)  p2 (59.6,58.6,60.5)
        p3 (74.9,72.8,70.7)  p4 (76.5,74.4,72.3)  p5 (76.1,74.0,71.9)
        p6 (75.3,71.4,66.9)  p7 (73.3,67.4,60.3)
     They are NOT a global tint of each other (best-fit per channel gain
     leaves an RMS of 17-25 on a mean of 65), so they are eight distinct
     bakes. Where two variants of a sheet are byte-identical the pairs are
     always adjacent -- over the 111 eight-page sheets the equality
     partitions are only (0,1,2,3,4,5,6,7) x94, (0,0,2,3,3,3,6,7) x13,
     (0,1,2,3,4,4,6,7) x2, (0,1,2,3,3,5,6,7) x1 and (0,1,2,3,3,3,6,7) x1,
     i.e. the collapses are 0=1 and 3=4=5, exactly the neighbours whose
     means are closest above. An ordered sequence, not eight unrelated
     bakes.

     These were CHECKED and are dead ends, recorded so nobody repeats them:
       - the tile's own actors. NMovableSunLight, NSun, NMoon, SkyZoneInfo
         and LevelInfo were dumped in full on 22_22; not one property names
         a phase, an hour, a count of 8 or an index. LevelInfo has no
         TimeOfDay.
       - the binaries. engine.dll's surviving export names are stock UE2
         (FLightMap, FLightMapTexture, FStaticLightMapTexture,
         FMultiLightMapTexture with AddLightMapTexture/AddLightMapIndex,
         CompressLightmaps) and carry no phase vocabulary; D3DDrv.dll,
         NWindow.dll, WinDrv.dll, Window.dll and Core.dll contain the
         string "lightmap" ZERO times; Engine.u, Core.u, GamePlay.u,
         Interface.u, LineageEffect.u and LineageDeco.u likewise.
       - "the 1-variant sheets are the ones the sun never reaches". 27 of
         the 138 sheets carry 1 page and 111 carry 8, and 7 tiles hold
         both. If the split were sun exposure the two halves would not
         share materials -- they do: Schtgart_Dwarf_MithrilMines_T.
         Dwarf_Tunnel01 has 527 records on 25_12's 1-page sheets and 69 on
         its 8-page ones, and dion_curumadungeon_t.Cm_dg_wall001 straddles
         20_21's the same way. REFUTED, not "unclear".
     So the client still shows variant 0, `?lm=<0..7>` still swaps it, and
     evidence that fixes a runtime phase should change the default.

  1b. VARIANT 0 IS THE PRIMARY, and that is a measurement.
     Each atlas page carries `i32 Header[3]`. Header[0] was written up as
     "steps by exactly 512 per sheet" -- true on the single-sheet tiles it
     was read on, and the wrong generalisation. What it actually does,
     measured over all 96 tiles that carry records:
       * take page 0 of each sheet, in sheet order. Those values form a
         STRICT arithmetic run of step 512 on 96 of 96 tiles.
       * every one of the other 777 pages (the 1..7 of each 8-page sheet)
         falls OUTSIDE the range that run spans. 777 outside, 0 inside.
     So the file holds one primary lightmap texture per sheet, contiguous
     and in sheet order, plus a separate block of seven alternates per
     8-page sheet. Variant 0 is not "the first thing in the array"; it is
     the sheet's entry in the level's PRIMARY array, and 1..7 are not in
     that array at all. That is why the client defaults to it.
     What Header[0] means beyond "consecutive elements of one array with a
     512-byte stride" is not established, and it is not named here.

  1c. THE SHADOW MASKS ARE PER-VARIANT. The sentence that used to stand in
     gap 1 -- "There is only ONE set of shadow masks for all eight, so the
     baked shadow geometry is shared" -- is FALSE, and it is the same
     failure as the tag: a correct count welded to an unexamined
     inference. Inside a record the masks are grouped by iLight and a
     light's masks are always CONSECUTIVE (7,819 records checked over five
     tiles, 0 interleaved), and a light carries 1..8 of them. The bound is
     the sheet's own variant count: over 25_12, 20_21, 24_12, 23_18 and
     22_25, records on a 1-VARIANT sheet never give a light more than one
     mask (1,916 records, max 1), and records on an 8-variant sheet reach
     exactly 8 and never 9 (3,410 records). The masks of one light are
     often byte-identical across the run but not always -- 23_18 has 3,902
     identical runs and 463 that differ. So each variant has its own
     shadow mask, and a light may be absent from some variants entirely.
     Nothing in this file draws them (gap 4), but the old sentence would
     have sent the next reader looking for a single shared bake.
  2. record field Q (0..38 across tiles) is unexplained. It is NOT the
     sheet index and it is NOT the variant index: 22_22 has one sheet with
     eight variants and Q up to 19; 20_21 has nine sheets and Q up to 38.
     The client does not need it -- the sheet comes from the membership
     arrays and the UVs come from the render vertices.
  3. three fields are consumed by LENGTH and not named: the u8 after the
     record count (0 on every tile), the five bytes that follow each
     record's Tag, and the 13-byte page footer (whose first nine bytes are
     the constant 03 00 02 00 00 00 02 00 00). --check pins the footer
     prefix, the lead byte and the Tag so the gap cannot grow quietly. The
     old fourth entry, "the per-variant Sep byte", is gone: it is not a
     byte and not a separator, it is the tile's Tag -- see "THE TAG".
  4. the shadow masks are decoded (dimensions, padding and bit counts all
     check out, and gap 1c establishes that their inner index is the
     variant) but are NOT used to draw anything: the composited atlas
     already contains what they contribute. They are emitted as a count.
  5. `iLight` in a mask is 1..125 on 22_22 while Model.Lights has 6746
     entries, so it is not a direct index into that array. Not resolved.
  6. CLOSED. All 100 tiles decode. 21_14 used to be the exception ("sheet 0
     declares 0 variants"); the data was never malformed -- this file was
     reading the tile's Tag as one byte and 21_14's Tag is 156. See "THE
     TAG". UNDECODED is now empty and --check still fails if any tile joins
     it or if a listed one starts decoding.
     Four tiles (19_13, 19_22, 22_21, 25_16) hold ZERO records, and
     that is consistent rather than a failure: not one of their BSP nodes
     has i_light_map >= 0, so nothing can reference a lightmap there.

OUTPUT (sibling files; scene.json and bsp.gltf are not touched by this tool)

    assets/world/<tile>/bsplight.json          records + counts + page list
    assets/world/<tile>/lightmap/g<S>p<V>.png  512x512 RGBA, sheet S
                                               variant V

Usage:
    python3 tools/world/bsplight.py <tile> [...]
    python3 tools/world/bsplight.py --all
    python3 tools/world/bsplight.py --check [tile ...]
"""

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from l2lib import (L2Error, PF_FAKEBACKDROP, PF_INVISIBLE,     # noqa: E402
                   PF_PORTAL, level_model, load_package)
from l2lib.textures import decode_dxt1, write_png             # noqa: E402
from l2lib.ue2package import Reader                           # noqa: E402

import lightmap as region_a                                   # noqa: E402

MAPS = os.path.join(ROOT, "assets", "interlude", "maps")
WORLD = os.path.join(ROOT, "assets", "world")

# Tiles whose region B does NOT decode, and the exact point where the walk
# stops. --check fails if this set changes in EITHER direction, so the gap
# can neither grow quietly nor be quietly declared fixed.
#
# It is EMPTY. It used to hold 21_14 ("sheet 0 declares 0 variants"); that
# was not malformed NCSoft data, it was this file reading the tile's Tag at
# the wrong width -- see "THE TAG" in the module docstring. All 100 tiles
# now walk region B to the byte.
UNDECODED = {}

# The Tag (see "THE TAG"): one compact index per tile, carried by every
# lightmap record's trailer AND by every atlas page. Pinned per tile because
# it is the field whose WIDTH broke 21_14, and because reading it as a u8
# would silently reproduce that bug on any tile whose value reaches 64.
# Measured from the .unr; 21_14's 156 is the only value in the world set
# that does not fit in one byte.
TAG_OVER_63 = {"21_14": 156}

# Drawn BSP nodes that carry neither a lightmap nor PF_UNLIT. Twelve in the
# whole world; see tools/world/bsp.py collect() for the materials. Pinned
# here so the number cannot drift.
UNLIT_UNFLAGGED = {"20_22": 4, "24_15": 2, "25_12": 6}

ATLAS = 512               # measured: max(X+W) == 512 and mip0 is 512*512/2
PAGES = 8                 # measured: exactly 8 on every tile
MIP_SIZES = (131072, 32768)
PAGE_FOOTER = 13          # measured: constant on every page of every tile
FOOTER_PREFIX = bytes((3, 0, 2, 0, 0, 0, 2, 0, 0))
RECORD_TAIL = 5           # bytes AFTER the record's cidx Tag; see "THE TAG"
VERTEX_SIZE = 40


class _R(Reader):
    """Reader plus the two composites this format needs."""

    def f32n(self, n):
        v = struct.unpack_from("<%df" % n, self.data, self.pos)
        self.pos += 4 * n
        return v

    def i32n(self, n):
        v = struct.unpack_from("<%di" % n, self.data, self.pos)
        self.pos += 4 * n
        return v


def region_b_start(pkg, model):
    """Byte offset of `cidx N`, i.e. just past the render section table."""
    info = region_a.decode_tail(pkg, model)
    end = model.export.serial_offset + model.export.serial_size
    return end - model.lightmap_tail + info["regionA"]["bytes"], end, info


def _index_array(r, n, what):
    """Read `cidx M, M x i32` of record indices, strictly ascending.

    Only the FIRST array of a sheet is the sheet's membership list; the
    ones between the variant pages repeat it on some tiles and are empty on
    others, so this returns the values and the caller decides.
    """
    m = r.compact()
    if not 0 <= m <= n:
        raise L2Error("%s: count %d, the record array holds %d"
                      % (what, m, n))
    values = list(r.i32n(m))
    for k in range(m):
        if not 0 <= values[k] < n or (k and values[k] <= values[k - 1]):
            raise L2Error("%s: entry %d is %d (not a strictly ascending "
                          "record index)" % (what, k, values[k]))
    return values


def decode(tile):
    """-> dict. Raises L2Error the moment the byte stream stops agreeing."""
    unr = os.path.join(MAPS, tile + ".unr")
    if not os.path.exists(unr):
        raise L2Error("no such map: %s" % unr)
    pkg, _proto = load_package(unr)
    model = level_model(pkg)
    if model is None:
        raise L2Error("%s: no level UModel" % tile)
    return decode_model(pkg, model, tile)


def lightmap_uvs(pkg, model):
    """-> {node index: [(u, v), ...]} for every node that carries one.

    The UVs are read straight out of the retail render vertices (bytes
    20..27), which is why nothing here reconstructs a projection.
    """
    sec_vp = _section_vertex_offsets(pkg, model)
    out = {}
    for i, node in enumerate(model.nodes):
        if node.i_light_map < 0:
            continue
        base = sec_vp[node.i_section]
        out[i] = [struct.unpack_from(
            "<2f", pkg.data,
            base + VERTEX_SIZE * (node.i_vert_offset + k) + 20)
            for k in range(node.num_vertices)]
    return out


def decode_model(pkg, model, tile):
    """The decoder proper, for callers that already hold the package."""
    start, end, info = region_b_start(pkg, model)
    r = _R(pkg.data, start, path=pkg.path)

    n = r.compact()
    if not 0 <= n < 200000:
        raise L2Error("implausible lightmap record count %d" % n)
    if n == 0:
        # Four tiles (19_13, 19_22, 22_21, 25_16) carry no lightmap records
        # at all, and that is CONSISTENT rather than a parse failure: not
        # one of their BSP nodes has an i_light_map >= 0, so no surface
        # references a lightmap. Their tail still holds unreferenced atlas
        # sheets; those are not walked, because nothing can point at them.
        lit = [nd for nd in model.nodes if nd.i_light_map >= 0]
        if lit:
            raise L2Error("0 lightmap records but %d nodes point at one"
                          % len(lit))
        return {"tile": tile, "atlas": ATLAS, "groups": 0, "pages": 0,
                "records": 0, "masks": 0, "maskBytes": 0, "surfsLit": 0,
                "surfsTotal": len(model.surfs), "nodesLit": 0,
                "nodesUnlit": len(model.nodes),
                "nodesTotal": len(model.nodes), "uvInsideRect": 0,
                "uvOutsideRect": 0, "usedTexels": 0, "leadByte": None,
                "tag": None, "primaryRun": True,
                "altPagesInsidePrimary": 0, "altPages": 0,
                "recordTails": [], "groupInfo": [], "recordList": [],
                "_pkg": pkg, "_model": model}
    lead = r.u8()

    records = []
    masks_total = 0
    mask_bytes = 0
    tails = set()
    tags = set()
    for i in range(n):
        i_surf = r.compact()
        q = r.compact()
        x = r.compact()
        y = r.compact()
        w = r.compact()
        h = r.compact()
        if not 0 <= i_surf < len(model.surfs):
            raise L2Error("record %d: iSurf %d is not a surface (0..%d)"
                          % (i, i_surf, len(model.surfs) - 1))
        if w <= 0 or h <= 0 or x < 0 or y < 0 \
                or x + w > ATLAS or y + h > ATLAS:
            raise L2Error("record %d: rect %d,%d %dx%d leaves the %dx%d atlas"
                          % (i, x, y, w, h, ATLAS, ATLAS))
        floats = r.f32n(25)
        nmask = r.compact()
        if not 0 <= nmask < 100000:
            raise L2Error("record %d: implausible mask count %d" % (i, nmask))
        # gap 1c: the masks are grouped by iLight, a light's masks are
        # consecutive, and the length of a light's run is its variant
        # index +1 -- bounded by the sheet's own variant count. Measured
        # here so --check re-proves it from the .unr every run.
        run_light = None
        run_len = 0
        run_max = 0
        seen_lights = set()
        for k in range(nmask):
            i_light = r.compact()                        # gap 5
            if i_light != run_light:
                if i_light in seen_lights:
                    raise L2Error(
                        "record %d mask %d: light %d appears again after "
                        "another light -- a light's masks are consecutive "
                        "on every record measured" % (i, k, i_light))
                seen_lights.add(i_light)
                run_light, run_len = i_light, 0
            run_len += 1
            run_max = max(run_max, run_len)
            length = r.compact()
            if not 0 < length <= 1 << 22:
                raise L2Error("record %d mask %d: bad length %d"
                              % (i, k, length))
            r.bytes(length)
            mw, mh, row, pad_u, pad_v, u_clamp, v_clamp = r.i32n(7)
            if u_clamp != mw + pad_u - 1 or v_clamp != mh + pad_v - 1:
                raise L2Error(
                    "record %d mask %d: clamp %d,%d does not match "
                    "%dx%d + pad %d,%d" % (i, k, u_clamp, v_clamp,
                                           mw, mh, pad_u, pad_v))
            if row != (mw + 7) // 8:
                raise L2Error("record %d mask %d: row bytes %d, not "
                              "ceil(%d/8)" % (i, k, row, mw))
            if mw + pad_u > w or mh + pad_v > h:
                raise L2Error(
                    "record %d mask %d: %dx%d + pad %d,%d does not fit the "
                    "record's %dx%d rectangle"
                    % (i, k, mw, mh, pad_u, pad_v, w, h))
            if length != row * mh:
                raise L2Error("record %d mask %d: %d data bytes, not %d*%d"
                              % (i, k, length, row, mh))
            masks_total += 1
            mask_bytes += length
        # A COMPACT INDEX (the tile's Tag -- see "THE TAG" in the module
        # docstring; the same value the atlas pages carry) followed by five
        # bytes that are read by length and not named (gap 3). This used to
        # be read as a fixed six bytes, which is the same width only while
        # the Tag stays under 64: 21_14's Tag is 156 and 21_14 was the one
        # tile that did not decode.
        tag = r.compact()
        tags.add(tag)
        tails.add(bytes(r.bytes(RECORD_TAIL)))
        records.append({"surf": i_surf, "q": q, "x": x, "y": y,
                        "w": w, "h": h, "masks": nmask,
                        "maskRun": run_max,
                        "floats": [round(v, 6) for v in floats]})

    # --- the atlas SHEETS (groups) ---------------------------------------
    # A sheet is one 512x512 DXT1 image in `variants` colour versions. Its
    # first index array lists the ABSOLUTE record indices whose rectangles
    # live on it, and the sheets partition 0..N-1 in order (22_22 is one
    # sheet of 595; 20_21 is 294 + 216 + ... = 1888). The rectangles inside
    # a sheet never overlap -- 0 overlapping texels over every sheet of
    # every tile -- which is what proves the variants are versions of ONE
    # sheet rather than several different sheets.
    #
    #   sheet:
    #     cidx  Variants                  1 or 8 on every tile measured
    #     Variants x:
    #         cidx  Tag                   the tile's constant (see THE TAG)
    #         cidx  M, M x i32            record indices (see above)
    #         i32   Header[3]             [0] see KNOWN GAPS 1b
    #         2 x mip: i32 SkipPos, cidx Count, byte[Count]
    #         9 bytes + i32               page footer (gap 3)
    #     cidx  M, M x i32                trailing array, no Sep
    groups = []
    base = 0
    while r.pos < end:
        n_variants = r.compact()
        if not 1 <= n_variants <= PAGES:
            raise L2Error("sheet %d declares %d variants"
                          % (len(groups), n_variants))
        seps = []
        arrays = []
        pages = []
        for p in range(n_variants):
            # cidx, NOT u8 -- see "THE TAG". Identical field to the one
            # every record's trailer opens with.
            seps.append(r.compact())
            arrays.append(_index_array(r, n, "sheet %d array %d"
                                       % (len(groups), p)))
            header = r.i32n(3)
            mips = []
            for expect in MIP_SIZES:
                skip = r.i32()
                got = r.compact()
                if got != expect:
                    raise L2Error("sheet %d page %d mip %d: %d bytes, "
                                  "expected %d" % (len(groups), p, len(mips),
                                                   got, expect))
                data_at = r.pos
                r.bytes(got)
                if r.pos != skip:
                    raise L2Error(
                        "sheet %d page %d mip %d: SkipPos %d, data ends at %d"
                        % (len(groups), p, len(mips), skip, r.pos))
                mips.append((data_at, got))
            footer = bytes(r.bytes(PAGE_FOOTER))
            if footer[:len(FOOTER_PREFIX)] != FOOTER_PREFIX:
                raise L2Error("sheet %d page %d: footer starts %s, not %s"
                              % (len(groups), p,
                                 " ".join("%02x" % c
                                          for c in footer[:len(FOOTER_PREFIX)]),
                                 " ".join("%02x" % c for c in FOOTER_PREFIX)))
            pages.append({"header": list(header), "mip0": mips[0][0],
                          "footer": " ".join("%02x" % c for c in footer)})
        arrays.append(_index_array(r, n, "sheet %d trailing array"
                                   % len(groups)))
        members = arrays[0]
        if members != list(range(base, base + len(members))):
            raise L2Error("sheet %d covers %s.., not the run from %d"
                          % (len(groups), members[:4], base))
        if len(set(seps)) != 1:
            raise L2Error("sheet %d tag differs between its pages: %s"
                          % (len(groups), seps))
        tags.update(seps)
        groups.append({"first": base, "records": len(members),
                       "variants": n_variants, "sep": seps[0],
                       "arrayCounts": [len(a) for a in arrays],
                       "pageInfo": pages})
        base += len(members)
    if r.pos != end:
        raise L2Error("region B walk ended at %d, the export ends at %d "
                      "(%+d)" % (r.pos, end, r.pos - end))
    if base != n:
        raise L2Error("the atlas sheets cover %d records, the array has %d"
                      % (base, n))
    # THE TAG. Every record's trailer opens with it and every atlas page
    # repeats it, and the two agree on all 96 tiles that carry records. If
    # this set ever holds more than one value, one of the two fields is
    # being read at the wrong width again -- which is exactly the bug that
    # kept 21_14 (Tag 156, the only Tag >= 64 in the world set) from
    # decoding while the other 99 tiles walked cleanly.
    if len(tags) != 1:
        raise L2Error("the record trailers and the atlas pages disagree on "
                      "the tile's tag: %s" % sorted(tags))
    for g, group in enumerate(groups):
        for i in range(group["first"], group["first"] + group["records"]):
            records[i]["group"] = g
            # gap 1c: a light cannot carry more masks than its sheet has
            # variants. Structural, so it is raised here rather than only
            # reported: if it ever fails, the mask run is not the variant.
            if records[i]["maskRun"] > group["variants"]:
                raise L2Error(
                    "record %d: a light carries %d masks but its sheet has "
                    "only %d variants -- the mask run is not the variant "
                    "index" % (i, records[i]["maskRun"], group["variants"]))

    # gap 1b: page 0 of each sheet is the sheet's entry in the level's
    # PRIMARY lightmap-texture array -- those Header[0] values form one
    # strict 512-step run in sheet order, and every alternate page lies
    # outside it. This is the whole justification for the client defaulting
    # to variant 0, so it is re-derived from the .unr on every run.
    primary = [g["pageInfo"][0]["header"][0] for g in groups]
    primary_step = all(primary[k + 1] - primary[k] == 512
                       for k in range(len(primary) - 1))
    alt_inside = 0
    lo, hi = min(primary), max(primary)
    for group in groups:
        for page in group["pageInfo"][1:]:
            if lo <= page["header"][0] <= hi:
                alt_inside += 1

    # geometry link + the UV proof, re-derived here so --check re-proves it
    linked = 0
    unlit = 0
    uv_in = 0
    uv_out = 0
    sec_vp = _section_vertex_offsets(pkg, model)
    for node in model.nodes:
        if node.i_light_map < 0:
            unlit += 1
            continue
        if node.i_light_map >= n:
            raise L2Error("node points at lightmap record %d of %d"
                          % (node.i_light_map, n))
        rec = records[node.i_light_map]
        linked += 1
        base = sec_vp[node.i_section]
        for k in range(node.num_vertices):
            off = base + VERTEX_SIZE * (node.i_vert_offset + k)
            u, v = struct.unpack_from("<2f", pkg.data, off + 20)
            px, py = u * ATLAS, v * ATLAS
            if (rec["x"] - 0.75 <= px <= rec["x"] + rec["w"] + 0.75
                    and rec["y"] - 0.75 <= py <= rec["y"] + rec["h"] + 0.75):
                uv_in += 1
            else:
                uv_out += 1

    used = _used_texels(records, len(groups))
    return {
        "tile": tile,
        "atlas": ATLAS,
        "groups": len(groups),
        "pages": sum(len(g["pageInfo"]) for g in groups),
        "records": len(records),
        "masks": masks_total,
        "maskBytes": mask_bytes,
        "surfsLit": len(set(rec["surf"] for rec in records)),
        "surfsTotal": len(model.surfs),
        "nodesLit": linked,
        "nodesUnlit": unlit,
        "nodesTotal": len(model.nodes),
        "uvInsideRect": uv_in,
        "uvOutsideRect": uv_out,
        "usedTexels": used,
        "leadByte": lead,
        "tag": sorted(tags)[0],
        "primaryRun": primary_step,
        "altPagesInsidePrimary": alt_inside,
        "altPages": sum(len(g["pageInfo"]) - 1 for g in groups),
        "recordTails": sorted(" ".join("%02x" % c for c in t) for t in tails),
        "groupInfo": groups,
        "recordList": records,
        "_pkg": pkg,
        "_model": model,
    }


def _section_vertex_offsets(pkg, model):
    """Byte offset of each render section's vertex block (region A)."""
    end = model.export.serial_offset + model.export.serial_size
    r = _R(pkg.data, end - model.lightmap_tail, path=pkg.path)
    out = []
    for _ in range(r.compact()):
        nverts = r.compact()
        out.append(r.pos)
        r.bytes(VERTEX_SIZE * nverts)
        r.i32(); r.compact(); r.i32(); r.u32(); r.i32()
    return out


def _used_texels(records, ngroups):
    sheets = [[bytearray(ATLAS) for _ in range(ATLAS)]
              for _ in range(ngroups)]
    for rec in records:
        rows = sheets[rec["group"]]
        for yy in range(rec["y"], min(rec["y"] + rec["h"], ATLAS)):
            row = rows[yy]
            for xx in range(rec["x"], min(rec["x"] + rec["w"], ATLAS)):
                row[xx] = 1
    return sum(sum(sum(row) for row in rows) for rows in sheets)


def write_tile(tile):
    info = decode(tile)
    pkg = info.pop("_pkg")
    info.pop("_model")
    out_dir = os.path.join(WORLD, tile)
    if not os.path.isdir(out_dir):
        raise L2Error("%s: run convert.py first (no %s)" % (tile, out_dir))
    lm_dir = os.path.join(out_dir, "lightmap")
    if not os.path.isdir(lm_dir):
        os.makedirs(lm_dir)
    files = []
    for g, group in enumerate(info["groupInfo"]):
        for p, page in enumerate(group["pageInfo"]):
            off = page["mip0"]
            rgba = decode_dxt1(pkg.data[off:off + MIP_SIZES[0]],
                               ATLAS, ATLAS)
            name = "g%dp%d.png" % (g, p)
            write_png(os.path.join(lm_dir, name), ATLAS, ATLAS, rgba)
            files.append("lightmap/" + name)
    shipped = dict(info)
    shipped["pageFiles"] = files
    with open(os.path.join(out_dir, "bsplight.json"), "w") as f:
        json.dump(shipped, f, separators=(",", ":"))
    return info


def converted_tiles():
    return sorted(d for d in os.listdir(WORLD)
                  if os.path.isdir(os.path.join(WORLD, d))
                  and os.path.exists(os.path.join(WORLD, d, "scene.json"))
                  and os.path.exists(os.path.join(MAPS, d + ".unr")))


PF_UNLIT = 0x00400000
SKIP_FLAGS = PF_INVISIBLE | PF_PORTAL | PF_FAKEBACKDROP


def unlit_unflagged(model):
    """Drawn nodes with no lightmap whose surface is not PF_UNLIT."""
    n = 0
    for node in model.nodes:
        surf = model.surfs[node.i_surf]
        if surf.flags & SKIP_FLAGS:
            continue
        if node.i_light_map < 0 and not surf.flags & PF_UNLIT:
            n += 1
    return n


def check(tiles):
    problems = []
    for tile in tiles:
        try:
            info = decode(tile)
        except L2Error as exc:
            if tile in UNDECODED:
                if UNDECODED[tile] not in str(exc):
                    problems.append(
                        "%s: is a KNOWN undecodable tile but the walk now "
                        "stops at '%s', not '%s'"
                        % (tile, exc, UNDECODED[tile]))
                continue
            problems.append("%s: region B did not decode: %s" % (tile, exc))
            continue
        if tile in UNDECODED:
            problems.append("%s: is listed as undecodable but it decoded -- "
                            "remove it from UNDECODED" % tile)
        n = unlit_unflagged(info["_model"])
        if n != UNLIT_UNFLAGGED.get(tile, 0):
            problems.append(
                "%s: %d drawn nodes carry neither a lightmap nor PF_UNLIT, "
                "UNLIT_UNFLAGGED says %d -- the retail lighting model the "
                "client relies on has moved"
                % (tile, n, UNLIT_UNFLAGGED.get(tile, 0)))
        info.pop("_pkg")
        info.pop("_model")
        if info["uvOutsideRect"]:
            problems.append(
                "%s: %d render-vertex lightmap UVs fall outside their own "
                "record rectangle -- bytes 20..27 are only the lightmap UV "
                "if that count is 0" % (tile, info["uvOutsideRect"]))
        if info["nodesLit"] and not info["uvInsideRect"]:
            problems.append("%s: %d lit nodes but no UVs checked"
                            % (tile, info["nodesLit"]))
        for g, group in enumerate(info["groupInfo"]):
            if not 1 <= len(group["pageInfo"]) <= PAGES:
                problems.append("%s: group %d has %d pages, not 1..%d"
                                % (tile, g, len(group["pageInfo"]), PAGES))
            for p, page in enumerate(group["pageInfo"]):
                if not page["footer"].startswith("03 00 02 00 00 00 02 00 00"):
                    problems.append(
                        "%s: sheet %d page %d footer is '%s', not the "
                        "constant prefix (an undocumented field changed)"
                        % (tile, g, p, page["footer"]))
        if info["records"] and info["leadByte"] != 0:
            problems.append("%s: the byte after the record count is %d, "
                            "not 0" % (tile, info["leadByte"]))
        # THE TAG's WIDTH. This is the gate that fails on the pre-fix tree:
        # a build that reads the tag as a u8 cannot decode 21_14 at all, and
        # a build that reads it as one byte on a tile whose tag reaches 64
        # would desync every record after it. Pinned per tile so neither the
        # value nor the "only 21_14 exceeds 63" claim can drift unnoticed.
        if info["records"]:
            tag = info["tag"]
            expect = TAG_OVER_63.get(tile)
            if expect is not None and tag != expect:
                problems.append(
                    "%s: tag is %r, TAG_OVER_63 says %d -- the field whose "
                    "width broke this tile has moved" % (tile, tag, expect))
            # WHY VARIANT 0 IS THE DEFAULT (KNOWN GAPS 1b). If either of
            # these two ever fails, the client's default variant loses its
            # justification and goes back to being an arbitrary pick --
            # editor/world/js/bsp.js says so in as many words.
            if not info["primaryRun"]:
                problems.append(
                    "%s: the page-0 Header[0] values do not form a strict "
                    "512-step run in sheet order -- variant 0 is no longer "
                    "sourced as the level's primary lightmap texture, and "
                    "bsp.js's default has lost its evidence" % tile)
            if info["altPagesInsidePrimary"]:
                problems.append(
                    "%s: %d of %d alternate pages fall INSIDE the primary "
                    "run -- pages 1..7 are supposed to sit in a separate "
                    "block (KNOWN GAPS 1b)"
                    % (tile, info["altPagesInsidePrimary"], info["altPages"]))
            if expect is None and tag is not None and tag > 63:
                problems.append(
                    "%s: tag is %d, i.e. it does NOT fit in one byte, but "
                    "the tile is not in TAG_OVER_63 -- add it, and check "
                    "that nothing reads this field as a u8" % (tile, tag))
        # the shipped sibling files must match what the .unr decodes to now
        d = os.path.join(WORLD, tile)
        path = os.path.join(d, "bsplight.json")
        if os.path.exists(path):
            with open(path) as f:
                have = json.load(f)
            for key in ("records", "masks", "usedTexels", "nodesLit",
                        "uvInsideRect", "surfsLit", "groups"):
                if have.get(key) != info[key]:
                    problems.append("%s: bsplight.json %s is %r, the .unr "
                                    "decodes to %r (stale)"
                                    % (tile, key, have.get(key), info[key]))
            for name in have.get("pageFiles", []):
                if not os.path.exists(os.path.join(d, name)):
                    problems.append("%s: %s is missing" % (tile, name))
            if len(have.get("pageFiles", [])) != info["pages"]:
                problems.append("%s: bsplight.json lists %d page files, the "
                                ".unr decodes %d"
                                % (tile, len(have.get("pageFiles", [])),
                                   info["pages"]))
        elif info["records"]:
            problems.append("%s: %d lightmap records decode but no "
                            "bsplight.json is shipped" % (tile,
                                                          info["records"]))
    return problems


def main(argv):
    args = argv[1:]
    if not args:
        print(__doc__)
        return 1
    if args[0] == "--check":
        tiles = args[1:] or converted_tiles()
        problems = check(tiles)
        for p in problems:
            print("FAIL " + p)
        print("--check: %d tiles, %d problems" % (len(tiles), len(problems)))
        return 1 if problems else 0
    tiles = converted_tiles() if args[0] == "--all" else args
    failures = 0
    for tile in tiles:
        try:
            info = write_tile(tile)
        except L2Error as exc:
            print("%-8s FAILED: %s" % (tile, exc))
            failures += 1
            continue
        print("%-8s %5d records  %5d masks  %2d sheets/%3d pages  "
              "%6d texels (%4.1f%%)"
              "  %4d/%4d surfs lit  %5d/%5d nodes lit  UV in/out %d/%d"
              % (tile, info["records"], info["masks"], info["groups"],
                 info["pages"], info["usedTexels"],
                 100.0 * info["usedTexels"]
                 / (ATLAS * ATLAS * max(info["groups"], 1)),
                 info["surfsLit"], info["surfsTotal"],
                 info["nodesLit"], info["nodesTotal"],
                 info["uvInsideRect"], info["uvOutsideRect"]))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
