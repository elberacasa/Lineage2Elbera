#!/usr/bin/env python3
"""Export the retail click-destination marker texture (Engine.Gui021).

WHAT THIS IS. When you left-click the ground in retail Interlude the client
drops a decal at the point you clicked. It is not an emitter and it is not in
any of the effect tables, which is why searching skillvfx/lineageeffect/
skillfx for it comes up empty — it is `Engine.MarkProjector`, a native
Projector subclass whose class source lives in the encrypted
assets/interlude/system/Engine.u:

    class MarkProjector extends Projector
        placeable
        native;

    #exec Texture Import File=Textures\\gui021.tga  Name=Gui021 Mips=Off \\
          MASKED=1 UCLAMPMODE=CLAMP VCLAMPMODE=CLAMP

    var() vector  DesireLocation;          // <- the clicked point
    var() vector  OffsetDesireLocation;
    var() bool    bAttachMark;
    var() Actor   ProjectedActor;

    native final function bool UpdateDesireLocation();   // ifdef __L2 kurt

    simulated function Timer() { DetachProjector(true); }

    function UpdateMarkProjector()
    {
        if(bAttachMark)
        {
            DetachProjector(true);
            SetCollision(false,false,false);
            FOV = 1;
            UpdateDesireLocation();
            SetLocation(DesireLocation);
            SetRotation(Rotator((-OffsetDesireLocation)));
            SetDrawScale(0.10);
            AttachProjector();
            SetCollision(true,false,false);
            bAttachMark=false;
            SetTimer(10, false);
        }
    }

and whose class defaults (decoded from the same package's Class export by
this script's --dump-defaults mode) are:

    MaterialBlendingOp     = 2   (PB_AlphaBlend)
    FrameBufferBlendingOp  = 2   (PB_AlphaBlend)
    ProjTexture            = Engine.Gui021
    bProjectBSP            = False
    bProjectStaticMesh     = False
    bProjectParticles      = False
    bProjectActor          = False
    bClipBSP               = True
    bGradient              = True
    bProjectOnAlpha        = True
    bProjectOnParallelBSP  = True
    MaxTraceDistance       = 1000   (inherited from Projector)
    bProjectTerrain        = True   (inherited from Projector)

So: an alpha-blended decal of Gui021, projected onto TERRAIN ONLY, living
exactly 10 seconds. The on-ground FOOTPRINT is not recoverable from here —
UE2 builds the projector frustum from FOV/MaxTraceDistance/DrawScale in
native code (UnProjector.cpp), which is not in this repository.

Output (regenerable):  assets/gamedata/markprojector/gui021.png

Usage:
  python3 tools/dat/export_markprojector.py
  python3 tools/dat/export_markprojector.py --check
  python3 tools/dat/export_markprojector.py --dump-defaults
"""

import argparse
import os
import struct
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools"))

from l2lib.ue2package import (  # noqa: E402
    Package, Reader, encode_compact, read_properties)
from l2lib.textures import extract_texture_rgba, write_png  # noqa: E402

ENGINE_U = os.path.join(REPO, "assets/interlude/system/Engine.u")
L2ENCDEC = os.path.join(REPO, "tools/bin/l2encdec")
PROTOCOL = "111"
OUT_DIR = os.path.join(REPO, "assets/gamedata/markprojector")
OUT_PNG = os.path.join(OUT_DIR, "gui021.png")
TEXTURE = "Gui021"


def decrypted_engine():
    with tempfile.TemporaryDirectory() as td:
        dest = os.path.join(td, "Engine.u")
        subprocess.run([L2ENCDEC, "-c", "decode", "-p", PROTOCOL, "-o", dest, ENGINE_U],
                       check=True, capture_output=True)
        with open(dest, "rb") as fh:
            return fh.read()


def dump_defaults(pkg, data, cls):
    """Recover a Class export's defaultproperties stream.

    UE2 writes a class's defaults as an ordinary tagged property list at the
    tail of the Class export, after the script. There is no offset for it in
    the header, so this walks to the first position where a known property
    tag parses cleanly and keeps the longest successful parse.
    """
    names = {n: i for i, n in enumerate(pkg.names)}
    exps = [e for e in pkg.exports
            if pkg.export_name(e) == cls and pkg.class_name_of(e) == "Class"]
    if not exps:
        return None
    e = exps[0]
    body = data[e.serial_offset:e.serial_offset + e.serial_size]
    best = None
    for probe in ("ProjTexture", "MaxTraceDistance", "MaterialBlendingOp",
                  "FrameBufferBlendingOp", "bProjectTerrain"):
        if probe not in names:
            continue
        tag = encode_compact(names[probe])
        pos = body.find(tag)
        while pos >= 0:
            try:
                props = read_properties(pkg, Reader(body, pos), fmt="auto")
                if len(props) >= 2 and (best is None or len(props) > len(best)):
                    best = props
            except Exception:
                pass
            pos = body.find(tag, pos + 1)
    return best


def render_defaults(pkg, props):
    out = []
    for k, v in props.items():
        if isinstance(v, (bytes, bytearray)):
            if k in ("ProjTexture", "GradientTexture", "Texture"):
                ref = Reader(bytes(v)).compact()
                out.append("%s = %s" % (k, pkg.ref_name(ref)[1]))
            elif len(v) == 4:
                out.append("%s = %d (int) / %g (float)"
                           % (k, struct.unpack("<i", v)[0], struct.unpack("<f", v)[0]))
            else:
                out.append("%s = %s" % (k, bytes(v).hex()))
        else:
            out.append("%s = %s" % (k, v))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify, write nothing")
    ap.add_argument("--dump-defaults", action="store_true",
                    help="print the Projector/MarkProjector class defaults")
    args = ap.parse_args()

    data = decrypted_engine()
    pkg = Package(data, "Engine.u")

    if args.dump_defaults:
        for cls in ("Projector", "MarkProjector"):
            props = dump_defaults(pkg, data, cls)
            print("== %s" % cls)
            for line in (render_defaults(pkg, props) if props else ["<not recovered>"]):
                print("   " + line)

    exps = [e for e in pkg.exports if pkg.export_name(e) == TEXTURE]
    if not exps:
        print("FAIL: Engine.u has no export named %s" % TEXTURE)
        return 1
    w, h, rgba, tex = extract_texture_rgba(pkg, exps[0], 0)
    print("%s: %dx%d %s" % (TEXTURE, w, h, tex.format_name))
    if w != 256 or h != 256:
        print("FAIL: expected the shipped 256x256 gui021.tga, got %dx%d" % (w, h))
        return 1

    if args.check:
        if not os.path.exists(OUT_PNG):
            print("FAIL: %s missing (run without --check)" % OUT_PNG)
            return 1
        print("OK: %s present" % OUT_PNG)
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    write_png(OUT_PNG, w, h, rgba)
    print("wrote %s" % OUT_PNG)
    return 0


if __name__ == "__main__":
    sys.exit(main())
