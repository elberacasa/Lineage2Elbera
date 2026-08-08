#!/usr/bin/env python3
"""Recover the UE2 particle-emitter CLASS DEFINITIONS from Engine.u.

WHY THIS EXISTS
---------------
Everything `parse_skillfx.py` / `build_skillvfx.py` / `skillvfx.js` do with an
emitter record depends on two things the emitter record itself does NOT carry:

  1. what each property MEANS (is StartSizeRange a size in UE units or a scale
     on a mesh? is SpinsPerSecondRange in degrees or revolutions?), and
  2. what the CLASS DEFAULT is -- because UE1/2 packed property streams omit
     every value equal to the class default, so an absent property is not
     "unset", it is "the default", and you cannot render faithfully without it.

Until now both were inferred from value counts across the data ("this bool is
only ever serialised true, so its default must be false"). That inference is
sound but indirect. It does not have to be: `system/Engine.u` still ships

  * the UnrealScript SOURCE of ParticleEmitter / SpriteEmitter / MeshEmitter /
    VertMeshEmitter / BeamEmitter, in a TextBuffer export named `ScriptText`
    that hangs off each Class export, and
  * each class's DEFAULT PROPERTY STREAM, at the tail of the Class export body.

This tool reads both and prints them. Every default it prints is a retail byte,
not a reading of the data.

HOW THE DEFAULTS ARE LOCATED
----------------------------
A UE2 UClass body is UState + ClassFlags/Guid/dependencies/... and then the
defaults as an ordinary packed property stream. The variable-length script
bytecode in the middle cannot be skipped reliably, so instead of modelling the
header this tool SEARCHES for the unique offset at which a packed property
stream parses cleanly and ends EXACTLY on the last byte of the export body.
That is a self-checking parse: a wrong offset desyncs within a few properties
and cannot land on the end of the body. (The first one or two names printed for
each class are the misaligned tail of the preceding header and are ignored --
they are the bytes the search consumed to find the stream's true start.)

Usage:
  /usr/bin/python3 tools/dat/dump_emitter_classes.py            # print everything
  /usr/bin/python3 tools/dat/dump_emitter_classes.py --defaults # defaults only
  /usr/bin/python3 tools/dat/dump_emitter_classes.py --check    # assert the
      defaults the rest of the pipeline relies on; exit 1 if any drifts
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "l2lib"))
from ue2package import load_package, Reader  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_skillfx import read_packed, decode_value  # noqa: E402

ENGINE_U = os.path.join(ROOT, "assets", "interlude", "system", "Engine.u")
CLASSES = ("ParticleEmitter", "SpriteEmitter", "MeshEmitter",
           "VertMeshEmitter", "BeamEmitter")

# The defaults every consumer in this repo depends on. Each entry is
# (class, property, expected) and is asserted by --check, so a wrong reading
# anywhere downstream shows up here instead of on screen.
EXPECTED = [
    # ParticleEmitter: the base particle contract
    ("ParticleEmitter", "MaxParticles", 10),
    ("ParticleEmitter", "LifetimeRange", {"Min": 4.0, "Max": 4.0}),
    ("ParticleEmitter", "Opacity", 1.0),
    ("ParticleEmitter", "RespawnDeadParticles", True),
    ("ParticleEmitter", "AutomaticInitialSpawning", True),
    ("ParticleEmitter", "UseRegularSizeScale", True),
    ("ParticleEmitter", "SpinCCWorCW", [0.5, 0.5, 0.5]),
    ("ParticleEmitter", "CoordinateSystem", 1),        # PTCS_Relative
    ("ParticleEmitter", "DrawStyle", 3),               # PTDS_Translucent
    # a SPRITE's default size is 100 UU (a 1 m quad) ...
    ("ParticleEmitter", "StartSizeRange",
     {"X": {"Min": 100.0, "Max": 100.0}, "Y": {"Min": 100.0, "Max": 100.0},
      "Z": {"Min": 100.0, "Max": 100.0}}),
    # ... and a MESH's is 1.0, which is what proves StartSizeRange is a SCALE
    # on the static mesh, not a size in world units.
    ("MeshEmitter", "StartSizeRange",
     {"X": {"Min": 1.0, "Max": 1.0}, "Y": {"Min": 1.0, "Max": 1.0},
      "Z": {"Min": 1.0, "Max": 1.0}}),
    ("MeshEmitter", "UseMeshBlendMode", True),
    ("VertMeshEmitter", "StartSizeRange",
     {"X": {"Min": 1.0, "Max": 1.0}, "Y": {"Min": 1.0, "Max": 1.0},
      "Z": {"Min": 1.0, "Max": 1.0}}),
    ("VertMeshEmitter", "UseMeshBlendMode", True),
    ("VertMeshEmitter", "RenderTwoSided", True),
]
# Properties that are NOT in any class-default stream, and therefore hold the
# UnrealScript zero value. --check asserts their absence (the interesting ones
# are the flags whose absence means "false").
EXPECTED_ABSENT = [
    ("MeshEmitter", "UseParticleColor"),
    ("MeshEmitter", "RenderTwoSided"),
    ("ParticleEmitter", "UseColorScale"),
    ("ParticleEmitter", "UseSizeScale"),
    ("ParticleEmitter", "UniformSize"),
    ("ParticleEmitter", "FadeIn"),
    ("ParticleEmitter", "FadeOut"),
    ("ParticleEmitter", "SpinParticles"),
]


def class_exports(pkg):
    """-> {class name: (1-based export index, Export)} for the emitter classes."""
    out = {}
    for e in pkg.exports:
        if pkg.class_name_of(e) == "Class" and pkg.export_name(e) in CLASSES:
            out[pkg.export_name(e)] = (pkg.exports.index(e) + 1, e)
    return out


def script_text(pkg, cls_index):
    """The .uc source of one class, out of its ScriptText TextBuffer export."""
    for e in pkg.exports:
        if pkg.class_name_of(e) != "TextBuffer" or e.package_index != cls_index:
            continue
        r = pkg.body_reader(e)
        raw = r.data[r.pos:e.serial_offset + e.serial_size].decode("latin1")
        m = re.search(r"\bclass\s+\w+\s+extends", raw)
        return raw[m.start():].rstrip("\x00 \t\r\n") if m else raw
    return None


def defaults(pkg, export):
    """The class-default property stream: {name: decoded value}, or None.

    Found by the unique-clean-parse search described in the module docstring.
    """
    start, end = export.serial_offset, export.serial_offset + export.serial_size
    for off in range(start, end):
        r = Reader(pkg.data, off)
        try:
            props = read_packed(pkg, r)
        except Exception:
            continue
        if r.pos != end or len(props) < 4:
            continue
        out = {}
        for name, (ptype, sname, raw) in props.items():
            try:
                out[name] = decode_value(pkg, ptype, sname, raw)
            except Exception:
                out[name] = {"_undecoded": raw.hex() if isinstance(raw, bytes) else raw}
        return out
    return None


def collect():
    pkg, _ = load_package(ENGINE_U)
    ce = class_exports(pkg)
    missing = [c for c in CLASSES if c not in ce]
    if missing:
        sys.exit("Engine.u has no Class export for: %s" % ", ".join(missing))
    return {name: {"script": script_text(pkg, idx), "defaults": defaults(pkg, e)}
            for name, (idx, e) in ce.items()}


def check(data):
    bad = []
    for cls, prop, want in EXPECTED:
        got = (data[cls]["defaults"] or {}).get(prop, "<absent>")
        if got != want:
            bad.append("%s.%s = %s, expected %s"
                       % (cls, prop, json.dumps(got), json.dumps(want)))
    for cls, prop in EXPECTED_ABSENT:
        if prop in (data[cls]["defaults"] or {}):
            bad.append("%s.%s is present in the class defaults but was read as "
                       "the zero value" % (cls, prop))
    for cls in CLASSES:
        if not data[cls]["script"]:
            bad.append("%s: no ScriptText recovered" % cls)
    if bad:
        for b in bad:
            print("CHECK FAIL: " + b)
        return 1
    print("CHECK PASS: %d emitter classes; %d class defaults and %d zero-value "
          "properties confirmed straight out of Engine.u"
          % (len(CLASSES), len(EXPECTED), len(EXPECTED_ABSENT)))
    return 0


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--defaults", action="store_true", help="skip the .uc source")
    args = ap.parse_args()
    data = collect()
    if args.check:
        return check(data)
    for cls in CLASSES:
        print("=" * 70)
        print("== %s" % cls)
        print("=" * 70)
        if not args.defaults and data[cls]["script"]:
            print(data[cls]["script"])
        print("-- class defaults (retail bytes) " + "-" * 36)
        for k, v in sorted((data[cls]["defaults"] or {}).items()):
            print("   %-30s %s" % (k, json.dumps(v)))
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
