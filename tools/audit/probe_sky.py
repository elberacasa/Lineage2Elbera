#!/usr/bin/env python3
"""Probe: what colour is the retail Lineage 2 sky?

`editor/world/js/main.js` paints the sky dome with a two-colour gradient:

    const SKY_ZENITH  = new THREE.Color(0x33415e);
    const SKY_HORIZON = new THREE.Color(0x93a5bd);

Neither number has a source, and `worldlight.js` -- which replaced the
client's invented fog and ambient with the map's own ZoneInfo values -- does
not touch them, so this gradient is what actually fills the upper half of the
screen on every outdoor tile.

The retail sky is not a gradient.  `assets/interlude/maps/skylevel.unr` is a
whole level: a SkyZoneInfo, an NSun, five NMoons and seven textured brushes,
importing from `L2_Skies` a ColorModifier literally named
`SkybackgroundColor`, plus `Cloud_Final`, `HazeRing_Final` and two
`StarField_Final` layers.

This script reads those ColorModifiers' own `Color` properties out of
`assets/interlude/textures/l2_skies.utx` (protocol 121, decoded with the
repo's own `utxedit.decode_121`) and prints them as #RRGGBB, so the sky can
be cited instead of chosen.

Read-only.  Writes nothing.

  python3 tools/audit/probe_sky.py
  python3 tools/audit/probe_sky.py --check
"""

import argparse
import os
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools"))
sys.path.insert(0, os.path.join(REPO, "tools/utx"))
sys.path.insert(0, os.path.join(REPO, "tools/maps"))

import utxedit                                   # noqa: E402
import unrmap                                    # noqa: E402
from l2lib import ue2package as U                # noqa: E402

SKIES = os.path.join(REPO, "assets/interlude/textures/l2_skies.utx")
SKYLEVEL = os.path.join(REPO, "assets/interlude/maps/skylevel.unr")


class Shim:
    """unrmap.read_props expects a utxedit-shaped package; l2lib's Package
    carries the same three things under different names."""

    def __init__(self, pkg):
        self._p = pkg
        self.data = pkg.data if hasattr(pkg, "data") else None

    def name(self, i):
        return self._p.name(i)


def load_skies():
    raw = open(SKIES, "rb").read()
    data = utxedit.decode_121(raw) if utxedit.detect_protocol(raw) == 121 else raw
    return U.Package(data, "l2_skies.utx"), data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(SKIES):
        print(f"missing {SKIES}", file=sys.stderr)
        return 2

    pkg, data = load_skies()
    shim = Shim(pkg)
    shim.data = data

    found = {}
    print("== ColorModifier exports in L2_Skies ==")
    for e in pkg.exports:
        if pkg.class_name_of(e) != "ColorModifier":
            continue
        nm = pkg.export_name(e)
        got = unrmap.find_prop_offset(shim, e)
        if not got:
            print(f"  {nm:<22} property list did not parse")
            continue
        _start, props, _rel = got
        line = []
        for p in props:
            if p["name"] == "Color" and p["struct"] == "Color" and p["size"] == 4:
                # UE2 FColor serialises B,G,R,A
                off = None
                # re-read the 4 raw bytes at the property's position
                line.append(p)
        # read_props does not decode FColor, so pull the bytes back out
        col = read_color(shim, e, props)
        mat = next((p["value"][1] for p in props
                    if p["name"] == "Material" and p["value"]), None)
        matname = pkg.ref_name(mat)[1] if mat is not None else "?"
        if col:
            # FColor serialises B,G,R,A -- the same order docs/ui-mined-native.md
            # established for the chat colour dwords mined out of NWindow.dll.
            # Corroborated here by the values themselves: under B,G,R,A the
            # background reads as sky blue and HazeRing (the glow around the
            # sun) reads as warm yellow; under R,G,B,A they would be orange and
            # cyan respectively, which is backwards for both.
            hexs = f"#{col[2]:02X}{col[1]:02X}{col[0]:02X}"
            found[nm] = (hexs, matname)
            flat = flat_texture(matname)
            note = ""
            if flat:
                note = (f"  <- tints {matname}, which is {flat[0]}x{flat[1]} of "
                        f"SOLID {flat[2]}: the modifier colour IS the rendered colour")
            elif matname != "?":
                note = f"  <- tints texture {matname} (not flat; result is texture x colour)"
            print(f"  {nm:<22} {hexs}  (B,G,R,A = {col}){note}")
        else:
            print(f"  {nm:<22} no Color property (class default)  material={matname}")

    print("\n== what the client uses instead (editor/world/js/main.js) ==")
    print("  SKY_ZENITH  #33415E     unsourced")
    print("  SKY_HORIZON #93A5BD     unsourced")

    if os.path.exists(SKYLEVEL):
        print(f"\nskylevel.unr is present ({os.path.getsize(SKYLEVEL)} bytes): "
              "the sky is a real textured level, not a gradient.")

    if args.check:
        want = "#0096CE"
        got = found.get("SkybackgroundColor", (None, None))[0]
        if got != want:
            print(f"\n--check FAIL: SkybackgroundColor = {got}, expected {want}",
                  file=sys.stderr)
            return 1
        if flat_texture("WhiteChip") is None:
            print("\n--check FAIL: WhiteChip is no longer a flat texture, so the "
                  "modifier colour is no longer the rendered colour", file=sys.stderr)
            return 1
        print(f"\n--check OK: SkybackgroundColor = {want} over a flat white chip")
    return 0


LIBRARY = os.path.join(REPO, "assets/library/l2_skies")


def flat_texture(name):
    """(w, h, '#RRGGBB') when the exported PNG is a single solid colour, else
    None.  A ColorModifier over a solid-white texture renders as exactly the
    modifier's colour -- which is what makes the sky decode complete rather
    than 'a tint over something we did not look at'."""
    path = os.path.join(LIBRARY, f"{name}.png")
    if not os.path.exists(path):
        return None
    try:
        from PIL import Image
    except ImportError:
        return None
    im = Image.open(path).convert("RGBA")
    cols = im.getcolors(maxcolors=4)
    if not cols or len(cols) != 1:
        return None
    _n, (r, g, b, _a) = cols[0]
    return im.size[0], im.size[1], f"#{r:02X}{g:02X}{b:02X}"


def read_color(shim, exp, props):
    """FColor is 4 bytes B,G,R,A; read_props leaves structs undecoded, so walk
    the stream again and grab the payload of the `Color` tag."""
    import re  # noqa
    r = utxedit.Reader(shim.data, exp.serial_offset)
    # find the property list start the same way find_prop_offset did
    for start in range(0, 25):
        try:
            p2, rel = unrmap.read_props(shim, exp, start)
        except Exception:
            continue
        if p2 and rel <= exp.serial_size:
            break
    else:
        return None
    # second pass, tracking byte offsets
    r = utxedit.Reader(shim.data, exp.serial_offset + start)
    while True:
        ni = r.compact()
        nm = shim.name(ni)
        if nm == "None":
            return None
        info = r.u8()
        ptype = info & 0xF
        sel = (info >> 4) & 7
        is_array = bool(info & 0x80)
        sname = None
        if ptype == 10:
            sname = shim.name(r.compact())
        if sel in unrmap.SIZE_SEL:
            ds = unrmap.SIZE_SEL[sel]
        elif sel == 5:
            ds = r.u8()
        elif sel == 6:
            ds = r.u16()
        else:
            ds = r.u32()
        if ptype != 3 and is_array:
            b = r.u8()
            if b >= 128:
                if b & 0x40:
                    r.u8(); r.u8(); r.u8()
                else:
                    r.u8()
        begin = r.pos
        if nm == "Color" and ptype == 10 and ds == 4:
            return tuple(shim.data[begin:begin + 4])
        r.pos = begin + ds


if __name__ == "__main__":
    sys.exit(main())
