"""Shared helpers for l2lib tests: paths, umodel -list parsing, TGA reading."""

import os
import re
import struct
import subprocess
import unittest

L2LIB_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS_DIR = os.path.dirname(L2LIB_DIR)
ROOT = os.path.dirname(TOOLS_DIR)

UMODEL = os.path.join(TOOLS_DIR, "bin", "umodel")
SAMPLE_UTX = os.path.join(TOOLS_DIR, "samples", "t_aden.utx")
FIGHTER_UKX = os.path.join(ROOT, "assets", "interlude", "animations",
                           "Fighter.ukx")
TEXTURES_DIR = os.path.join(ROOT, "assets", "interlude", "textures")
SYSTEX_DIR = os.path.join(ROOT, "assets", "interlude", "systextures")
SYSTEM_DIR = os.path.join(ROOT, "assets", "interlude", "system")
MAPS_DIR = os.path.join(ROOT, "assets", "interlude", "maps")

# collected during the test run, printed by run_tests.py
STATS = {
    "packages_parsed": 0,
    "exports_listed": 0,
    "textures_decoded": 0,
    "umodel_offsets_checked": 0,
    "dat_records_read": 0,
}

_LIST_LINE = re.compile(r"^\s*(\d+)\s+([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)"
                        r"\s+(\S+)\s+(.+?)\s*$")


def umodel_list(path):
    """Run `umodel -game=l2 -list` -> list of dicts with export info."""
    proc = subprocess.run([UMODEL, "-game=l2", "-list", path],
                          capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise unittest.SkipTest("umodel -list failed on %s: %s"
                                % (path, proc.stderr.strip()[:200]))
    out = []
    for line in proc.stdout.splitlines():
        m = _LIST_LINE.match(line)
        if m:
            out.append({
                "index": int(m.group(1)),
                "offset": int(m.group(2), 16),
                "size": int(m.group(3), 16),
                "cls": m.group(4),
                "name": m.group(5),
            })
    if not out:
        raise unittest.SkipTest("no exports parsed from umodel output for "
                                + path)
    return out


def read_tga(path):
    """Read a TGA file (type 2/3 uncompressed or 10 RLE, 24/32bpp).

    Returns (width, height, rgba_bytes), origin normalized to top-left.
    """
    with open(path, "rb") as f:
        data = f.read()
    (id_len, cmap_type, img_type, _cm_first, _cm_len, _cm_bpp,
     _x, _y, w, h, bpp, desc) = struct.unpack_from("<BBBHHBHHHHBB", data, 0)
    if cmap_type != 0 or img_type not in (2, 3, 10):
        raise ValueError("unsupported TGA (cmap=%d type=%d) in %s"
                         % (cmap_type, img_type, path))
    nch = bpp // 8
    if nch not in (1, 3, 4):
        raise ValueError("unsupported TGA bpp %d in %s" % (bpp, path))
    pos = 18 + id_len
    npix = w * h
    pix = bytearray()
    if img_type == 10:  # RLE
        while len(pix) < npix * nch:
            hdr = data[pos]
            pos += 1
            count = (hdr & 0x7F) + 1
            if hdr & 0x80:
                px = data[pos:pos + nch]
                pos += nch
                pix += px * count
            else:
                pix += data[pos:pos + count * nch]
                pos += count * nch
    else:
        pix = bytearray(data[pos:pos + npix * nch])
    top_down = bool(desc & 0x20)
    rgba = bytearray(npix * 4)
    for i in range(npix):
        if nch == 1:
            g = pix[i]
            r, g_, b, a = g, g, g, 255
        elif nch == 3:
            b, g_, r = pix[i * 3:i * 3 + 3]
            a = 255
        else:
            b, g_, r, a = pix[i * 4:i * 4 + 4]
        src_y, src_x = divmod(i, w)
        y = src_y if top_down else (h - 1 - src_y)
        o = (y * w + src_x) * 4
        rgba[o:o + 4] = bytes((r, g_, b, a))
    return w, h, bytes(rgba)


def mean_abs_error(a, b, channels=(0, 1, 2)):
    """Mean per-channel absolute error between two RGBA buffers."""
    n = len(a) // 4
    total = 0
    count = 0
    for c in channels:
        s = 0
        for i in range(c, n * 4, 4):
            d = a[i] - b[i]
            s += d if d >= 0 else -d
        total += s
        count += n
    return total / max(1, count)
