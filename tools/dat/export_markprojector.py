#!/usr/bin/env python3
"""Decode Engine.MarkProjector, and settle whether the client ever runs it.

WHAT THIS FILE USED TO CLAIM, AND WHY THAT WAS WRONG.

An earlier version of this script opened with "When you left-click the ground
in retail Interlude the client drops a decal at the point you clicked. It is
`Engine.MarkProjector`." Everything it then measured was correct — the class
source, the class defaults, the texture. The sentence in front of them was an
inference nobody checked, and the runtime was built on it: a Gui021 quad
parked at every click for 10 s, sized by a number chosen to look right.

Nothing in the client ties MarkProjector to a mouse click, and nothing in the
client ever instantiates it. `--evidence` re-derives that from the shipped
packages every time it runs:

  * `Spawn(class'MarkProjector', ...)` occurs ONCE in all 21 script packages,
    in LineageWarrior/WarfarePawn.PostBeginPlay, and it is COMMENTED OUT:

        //#ifdef __L2 //kurt
            //Mark = Spawn(class'MarkProjector',Self,'',Location);
        //#endif

  * `bAttachMark` — the flag UpdateMarkProjector() needs in order to do
    anything at all — is never assigned True anywhere. The only assignment in
    the client is `bAttachMark=false`, inside the block that flag guards.

  * `Pawn.Mark` is only ever READ, in WarfarePawn.Destroyed(), behind an
    `if (Mark != None)` guard that a never-spawned actor never passes.

  * engine.dll exports one MarkProjector native, `execUpdateDesireLocation`,
    and the client's only caller of it is that same dead script path.

  * No map places one. 157/157 .unr decrypted and scanned (`--scan-maps`),
    zero hits, against 2,421 StaticMeshActor hits in a single tile — so the
    scan reads real name tables and the zero is a measurement, not a
    vacuous pass.

The class is a repurposed ShadowProjector, and reads like one: the commented
imports are Sun.tga and GRADIENT_Fade.tga, the commented locals are
ShadowLocation / BoundingSphere / LightDirection, and the one spawn call was
written as `Spawn(class'MarkProjector', Self, '', Location)` — the PAWN's
location, not a picked point. `DesireLocation` is filled by native code we
cannot read (engine.dll is Themida-packed), so what the feature would have
marked is not recoverable either.

WHAT IS STILL SOURCED. The decode below is good and is kept: it is the record
of what this class WOULD draw, and it is what verify_markprojector.js asserts.
It is not licence to draw it.

  ProjTexture            Engine.Gui021 (#exec Texture Import gui021.tga,
                         256x256 RGBA8, Mips=Off MASKED=1, CLAMP both axes)
  MaterialBlendingOp     2  (PB_AlphaBlend)
  FrameBufferBlendingOp  2  (PB_AlphaBlend)     -> ordinary alpha, not additive
  bProjectBSP/StaticMesh/Particles/Actor  False -> terrain only
  bClipBSP / bGradient / bProjectOnAlpha / bProjectOnParallelBSP  True
  MaxTraceDistance       1000  (inherited from Projector)
  bProjectTerrain        True  (inherited from Projector)
  UpdateMarkProjector()  FOV = 1; SetDrawScale(0.10); SetTimer(10, false)
  Timer()                DetachProjector(true)   -> it would live 10 s

WHAT IS NOT RECOVERABLE. The on-ground FOOTPRINT. UE2 builds the projector
frustum from FOV / MaxTraceDistance / DrawScale in native code
(UnProjector.cpp), which is not in this repository, so no diameter in world
units can be computed here — which is exactly why the old runtime constant was
a guess. It stays unrecovered.

Outputs (regenerable):
  assets/gamedata/markprojector/gui021.png
  assets/gamedata/markprojector/markprojector.json

Usage:
  python3 tools/dat/export_markprojector.py
  python3 tools/dat/export_markprojector.py --check
  python3 tools/dat/export_markprojector.py --dump-defaults
  python3 tools/dat/export_markprojector.py --evidence      # print, write nothing
  python3 tools/dat/export_markprojector.py --scan-maps     # 157 .unr, slow
"""

import argparse
import glob
import json
import os
import re
import struct
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "tools"))

from l2lib.ue2package import (  # noqa: E402
    Package, Reader, encode_compact, read_properties)
from l2lib.textures import extract_texture_rgba, write_png  # noqa: E402

SYSTEM = os.path.join(REPO, "assets/interlude/system")
ENGINE_U = os.path.join(SYSTEM, "Engine.u")
MAPS = os.path.join(REPO, "assets/interlude/maps")
L2ENCDEC = os.path.join(REPO, "tools/bin/l2encdec")
PROTOCOL = "111"
OUT_DIR = os.path.join(REPO, "assets/gamedata/markprojector")
OUT_PNG = os.path.join(OUT_DIR, "gui021.png")
OUT_JSON = os.path.join(OUT_DIR, "markprojector.json")
TEXTURE = "Gui021"


def decrypt(src):
    """Ver111-decrypt a shipped package and return its bytes."""
    with tempfile.TemporaryDirectory() as td:
        dest = os.path.join(td, os.path.basename(src))
        subprocess.run([L2ENCDEC, "-c", "decode", "-p", PROTOCOL, "-o", dest, src],
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
                # AUTHORED threshold: a one-property parse is almost always a
                # false positive, so a candidate needs at least two tags.
                if len(props) >= 2 and (best is None or len(props) > len(best)):
                    best = props
            except Exception:
                pass
            pos = body.find(tag, pos + 1)
    return best


# read_properties() hands back RAW BYTES — UE2's property tag carries a type,
# but this reader does not surface it, so a 4-byte payload is ambiguous between
# int and float and has to be resolved by name. Both members below are declared
# float in UE2's Projector (ProjectorRadius defaults to -1.0 = "auto"); every
# other 4-byte default on these two classes is an int (MaxTraceDistance = 1000
# reads as a sane int and as 1.4e-42 as a float, which settles it).
FLOAT_PROPS = frozenset(("ProjectorRadius", "FOV", "DrawScale", "LightDistance"))
OBJREF_PROPS = frozenset(("ProjTexture", "GradientTexture", "Texture"))


def norm_defaults(pkg, props):
    """Property dict -> JSON-safe {name: value}, resolving object refs."""
    out = {}
    for k, v in (props or {}).items():
        if isinstance(v, (bytes, bytearray)):
            if k in OBJREF_PROPS:
                out[k] = pkg.ref_name(Reader(bytes(v)).compact())[1]
            elif len(v) == 1:
                out[k] = v[0]          # byte/enum property (e.g. the blend ops)
            # SPEC: UE2 tagged property — int and float payloads are 4 bytes.
            elif len(v) == 4 and k in FLOAT_PROPS:
                out[k] = struct.unpack("<f", v)[0]
            elif len(v) == 4:
                out[k] = struct.unpack("<i", v)[0]
            else:
                out[k] = bytes(v).hex()
        else:
            out[k] = v
    return out


# ---------------------------------------------------------------------------
# activation evidence
#
# UE2 keeps every class's ORIGINAL SOURCE TEXT in a TextBuffer export beside
# the bytecode (this is what tools/uscript/extract_uscript.py trades on), so
# these scans read the code NCSoft compiled, comments and all. That is also
# why "commented out" is a thing this can see at all.
# ---------------------------------------------------------------------------

SPAWN_RE = re.compile(r"^(?P<lead>[^\r\n]*?)Spawn\s*\(\s*class\s*'MarkProjector'",
                      re.M)
ATTACH_RE = re.compile(r"bAttachMark\s*=\s*(?P<val>\w+)")
# non-vacuity tripwire: these MUST be found, or the decrypt/scan is broken
DECL_RE = re.compile(r"var\s+MarkProjector\s+(\w+)\s*;")
CLASS_RE = re.compile(r"class\s+MarkProjector\s+extends\s+(\w+)")


def scan_packages():
    ev = {"packages_scanned": 0, "spawn_sites": [], "battachmark_writes": [],
          "declarations": [], "class_decl": None}
    for src in sorted(glob.glob(os.path.join(SYSTEM, "*.u"))):
        name = os.path.basename(src)
        text = decrypt(src).decode("latin-1")
        ev["packages_scanned"] += 1
        for m in SPAWN_RE.finditer(text):
            lead = m.group("lead")
            ev["spawn_sites"].append({
                "package": name,
                "commented": "//" in lead,
                # AUTHORED: 40 chars of trailing context, a print width.
                "text": text[m.start():m.end() + 40].split("\r")[0].strip(),
            })
        for m in ATTACH_RE.finditer(text):
            line_start = text.rfind("\n", 0, m.start()) + 1
            ev["battachmark_writes"].append({
                "package": name,
                "value": m.group("val").lower(),
                "commented": "//" in text[line_start:m.start()],
            })
        for m in DECL_RE.finditer(text):
            ev["declarations"].append({"package": name, "var": m.group(1)})
        m = CLASS_RE.search(text)
        if m:
            ev["class_decl"] = {"package": name, "extends": m.group(1)}
    ev["spawn_sites_active"] = sum(1 for s in ev["spawn_sites"] if not s["commented"])
    ev["battachmark_true_writes"] = sum(
        1 for w in ev["battachmark_writes"]
        if w["value"] == "true" and not w["commented"])
    return ev


def source_constants():
    """FOV / DrawScale / Timer, parsed out of MarkProjector's own source."""
    text = decrypt(ENGINE_U).decode("latin-1")
    i = text.find("class MarkProjector extends")
    if i < 0:
        raise SystemExit("FAIL: MarkProjector source text not found in Engine.u")
    # AUTHORED window: MarkProjector's source text is ~2.6 KB; 4000 covers it
    # with margin and stops before the next class in the TextBuffer.
    body = text[i:i + 4000]
    body = "\n".join(ln for ln in body.splitlines()
                     if not ln.strip().startswith("//"))

    def one(pat, cast):
        m = re.search(pat, body)
        return cast(m.group(1)) if m else None

    return {
        "FOV": one(r"\bFOV\s*=\s*([\d.]+)\s*;", float),
        "DrawScale": one(r"SetDrawScale\s*\(\s*([\d.]+)\s*\)", float),
        "timer_s": one(r"SetTimer\s*\(\s*([\d.]+)\s*,", float),
        "timer_loop": bool(re.search(r"SetTimer\s*\([\d.]+\s*,\s*true\s*\)", body)),
        "on_timer": "DetachProjector" if "DetachProjector" in body else None,
        # the one thing that would have made it a click marker, if it existed
        "reads_mouse": bool(re.search(r"mouse|cursor|click", body, re.I)),
    }


def scan_maps():
    """Decrypt every .unr and look for a placed MarkProjector.

    The control is deliberate: StaticMeshActor is counted at the same time, so
    a zero for MarkProjector can be distinguished from a scan that read
    nothing at all.
    """
    hits, control, n = [], 0, 0
    for src in sorted(glob.glob(os.path.join(MAPS, "*.unr"))):
        raw = decrypt(src)
        n += 1
        control += raw.count(b"StaticMeshActor")
        if b"MarkProjector" in raw:
            hits.append(os.path.basename(src))
    return {"maps_scanned": n, "maps_placing": hits,
            "control_staticmeshactor_hits": control}


def build(args):
    data = decrypt(ENGINE_U)
    pkg = Package(data, "Engine.u")

    defaults = {c: norm_defaults(pkg, dump_defaults(pkg, data, c))
                for c in ("Projector", "MarkProjector")}

    exps = [e for e in pkg.exports if pkg.export_name(e) == TEXTURE]
    if not exps:
        print("FAIL: Engine.u has no export named %s" % TEXTURE)
        return None
    w, h, rgba, tex = extract_texture_rgba(pkg, exps[0], 0)
    # 256x256 is decoded from the Gui021 export itself (see --dump-defaults);
    # a different size means the wrong export or a broken mip walk.
    if w != 256 or h != 256:
        print("FAIL: expected the shipped 256x256 gui021.tga, got %dx%d" % (w, h))
        return None

    ev = scan_packages()
    doc = {
        "texture": {"package": "Engine.u", "name": TEXTURE, "width": w,
                    "height": h, "format": tex.format_name,
                    "png": os.path.relpath(OUT_PNG, REPO)},
        "class_defaults": defaults,
        "source_constants": source_constants(),
        "activation": ev,
        # the conclusion the numbers above force, stated once so the runtime
        # and verify_markprojector.js can both read it instead of restating it
        "instantiated_by_client": (ev["spawn_sites_active"] > 0
                                   and ev["battachmark_true_writes"] > 0),
        "footprint_world_units": None,   # NOT RECOVERABLE — see module docstring
    }
    if args.scan_maps:
        doc["activation"]["maps"] = scan_maps()
    return doc, (w, h, rgba)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify, write nothing")
    ap.add_argument("--dump-defaults", action="store_true",
                    help="print the Projector/MarkProjector class defaults")
    ap.add_argument("--evidence", action="store_true",
                    help="print the activation evidence, write nothing")
    ap.add_argument("--scan-maps", action="store_true",
                    help="also decrypt all 157 .unr and look for placements")
    args = ap.parse_args()

    built = build(args)
    if built is None:
        return 1
    doc, (w, h, rgba) = built
    ev = doc["activation"]

    # Non-vacuity tripwires. Every zero this script reports is only meaningful
    # if the same scan found the things that ARE there.
    # AUTHORED floor: 21 .u packages ship with Interlude, so anything under
    # 20 means the decrypt or the glob failed rather than the feature is dead.
    if ev["packages_scanned"] < 20:
        print("FAIL: only %d script packages scanned" % ev["packages_scanned"])
        return 1
    if not ev["class_decl"]:
        print("FAIL: MarkProjector class declaration not found — decrypt broken")
        return 1
    if not ev["declarations"]:
        print("FAIL: no `var MarkProjector` declaration found — scan is vacuous")
        return 1
    if not ev["spawn_sites"]:
        print("FAIL: no Spawn(class'MarkProjector') site found at all — "
              "the scan is vacuous, not the feature dead")
        return 1

    if args.dump_defaults:
        for cls, props in doc["class_defaults"].items():
            print("== %s" % cls)
            for k, v in props.items():
                print("   %s = %s" % (k, v))

    if args.evidence or args.dump_defaults or args.check:
        print("== activation (%d script packages)" % ev["packages_scanned"])
        print("   class            %s extends %s"
              % (ev["class_decl"]["package"], ev["class_decl"]["extends"]))
        for d in ev["declarations"]:
            print("   declared as      var MarkProjector %s;  (%s)"
                  % (d["var"], d["package"]))
        for s in ev["spawn_sites"]:
            print("   spawn site       %s  %s  %s"
                  % (s["package"], "COMMENTED OUT" if s["commented"] else "LIVE",
                     s["text"]))
        for x in ev["battachmark_writes"]:
            print("   bAttachMark <-   %s  (%s%s)"
                  % (x["value"], x["package"],
                     ", commented" if x["commented"] else ""))
        print("   ACTIVE spawns    %d" % ev["spawn_sites_active"])
        print("   bAttachMark=true %d" % ev["battachmark_true_writes"])
        print("   => instantiated by the client: %s"
              % ("YES" if doc["instantiated_by_client"] else "NO"))
        if "maps" in ev:
            m = ev["maps"]
            print("   maps             %d scanned, %d place one "
                  "(control: %d StaticMeshActor hits)"
                  % (m["maps_scanned"], len(m["maps_placing"]),
                     m["control_staticmeshactor_hits"]))
        sc = doc["source_constants"]
        print("== source constants  FOV=%s DrawScale=%s Timer=%ss loop=%s -> %s"
              % (sc["FOV"], sc["DrawScale"], sc["timer_s"], sc["timer_loop"],
                 sc["on_timer"]))
        print("== footprint         NOT RECOVERABLE (native UnProjector.cpp)")

    print("%s: %dx%d %s" % (TEXTURE, w, h, doc["texture"]["format"]))

    if args.check:
        if not os.path.exists(OUT_PNG):
            print("FAIL: %s missing (run without --check)" % OUT_PNG)
            return 1
        if not os.path.exists(OUT_JSON):
            print("FAIL: %s missing (run without --check)" % OUT_JSON)
            return 1
        with open(OUT_JSON) as fh:
            on_disk = json.load(fh)
        fresh = dict(doc)
        fresh["activation"] = {k: v for k, v in doc["activation"].items()
                               if k != "maps"}
        stale = {k: v for k, v in on_disk.items() if k != "activation"}
        stale_act = {k: v for k, v in on_disk.get("activation", {}).items()
                     if k != "maps"}
        if stale != {k: v for k, v in fresh.items() if k != "activation"} \
                or stale_act != fresh["activation"]:
            print("FAIL: %s is stale — re-run without --check" % OUT_JSON)
            return 1
        print("OK: gui021.png + markprojector.json present and current")
        return 0

    if args.evidence:
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    write_png(OUT_PNG, w, h, rgba)
    with open(OUT_JSON, "w") as fh:
        # AUTHORED: file formatting only.
        json.dump(doc, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("wrote %s" % OUT_PNG)
    print("wrote %s" % OUT_JSON)
    return 0


if __name__ == "__main__":
    sys.exit(main())
