#!/usr/bin/env python3
"""ElberaLight — the tile's own sun, ambient and fog, decoded from the map.

The client's light rig was invented: a hand-picked sun direction, a hand-picked
intensity, a hand-picked ambient. The retail values are in the `.unr` and they
decode cleanly, so there is no reason to keep guessing at how the world is lit
(docs/foundation-audit.md F4).

Three actors carry it:

  NMovableSunLight  the directional sun. `LightBrightness` is a float and
                    `Rotation` is a UE Rotator (three int32, 65536 = 360 deg)
                    giving the direction the light points.
  ZoneInfo          `AmbientVector` (three floats, 0..1 RGB) and
                    `AmbientBrightness` (a byte) for the zone's ambient term,
                    plus the distance fog: `bDistanceFog`, `DistanceFogColor`
                    (RGBA bytes), `DistanceFogStart` / `DistanceFogEnd` floats.
  SkyZoneInfo       the sky dome's own pan speeds and lens flare scale.

Values ABSENT from a stream are absent because they equal the UE2 class
default — a packed property stream omits them. This tool therefore emits null
for anything it did not find rather than substituting a default it cannot read
out of the binary, and the client supplies the fallback at the point of use.
That keeps the "what retail actually says" and "what we do when it says
nothing" decisions separate and visible.

Output is a SIBLING file — assets/world/<tile>/light.json — because
scene.json is a frozen contract.

Usage:
  python3 tools/world/light_extract.py <tile>
  python3 tools/world/light_extract.py --all
  python3 tools/world/light_extract.py --check [tile ...]
"""

import argparse
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from l2lib import load_package                        # noqa: E402
from l2lib.ue2package import read_properties          # noqa: E402

MAPS = os.path.join(ROOT, "assets", "interlude", "maps")
WORLD = os.path.join(ROOT, "assets", "world")

# UE2 rotator: 65536 units per full turn.
ROT_TO_RAD = (math.pi * 2.0) / 65536.0


def _f32(raw):
    return struct.unpack("<f", raw)[0] if raw is not None and len(raw) == 4 else None


def _u8(raw):
    return raw[0] if raw is not None and len(raw) == 1 else None


def _rotator(raw):
    """(pitch, yaw, roll) as raw UE units, or None."""
    if raw is None or len(raw) != 12:
        return None
    return list(struct.unpack("<iii", raw))


def _color(raw):
    """UE2 FColor is B,G,R,A in memory order. Emitted as [r, g, b, a] 0..255."""
    if raw is None or len(raw) != 4:
        return None
    b, g, r, a = raw[0], raw[1], raw[2], raw[3]
    return [r, g, b, a]


def _vector(raw):
    if raw is None or len(raw) != 12:
        return None
    return list(struct.unpack("<fff", raw))


def _props(pkg, export):
    reader = (pkg.actor_body_reader(export)
              if hasattr(pkg, "actor_body_reader") else pkg.body_reader(export))
    return read_properties(pkg, reader)


def _first(pkg, cls):
    exports = pkg.exports_by_class(cls)
    if not exports:
        return None
    try:
        return _props(pkg, exports[0])
    except Exception:
        return None


def extract(tile):
    path = os.path.join(MAPS, "%s.unr" % tile)
    if not os.path.exists(path):
        raise IOError("no map for %s" % tile)
    pkg, _ = load_package(path)

    out = {"tile": tile, "sun": None, "ambient": None, "fog": None}

    sun = _first(pkg, "NMovableSunLight")
    if sun:
        rot = _rotator(sun.get("Rotation"))
        entry = {
            "brightness": _f32(sun.get("LightBrightness")),
            "rotation": rot,
        }
        if rot:
            # UE rotator -> a unit direction the light POINTS along.
            pitch, yaw = rot[0] * ROT_TO_RAD, rot[1] * ROT_TO_RAD
            cp = math.cos(pitch)
            entry["direction_l2"] = [cp * math.cos(yaw), cp * math.sin(yaw),
                                     math.sin(pitch)]
            entry["pitch_deg"] = math.degrees(pitch)
            entry["yaw_deg"] = math.degrees(yaw)
        out["sun"] = entry

    zone = _first(pkg, "ZoneInfo")
    if zone:
        out["ambient"] = {
            "vector": _vector(zone.get("AmbientVector")),
            "brightness": _u8(zone.get("AmbientBrightness")),
        }
        out["fog"] = {
            "enabled": bool(zone.get("bDistanceFog")) or None,
            "color": _color(zone.get("DistanceFogColor")),
            "start": _f32(zone.get("DistanceFogStart")),
            "end": _f32(zone.get("DistanceFogEnd")),
        }
    return out


def write(tile, verbose=True):
    data = extract(tile)
    out_dir = os.path.join(WORLD, tile)
    if not os.path.isdir(out_dir):
        if verbose:
            print("  skip %s: no converted tile" % tile)
        return None
    with open(os.path.join(out_dir, "light.json"), "w") as fh:
        json.dump(data, fh, indent=1, sort_keys=True)
    return data


def tiles():
    return sorted(n for n in os.listdir(WORLD)
                  if os.path.isdir(os.path.join(WORLD, n))
                  and os.path.exists(os.path.join(MAPS, "%s.unr" % n)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tiles", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    names = tiles() if (args.all or (args.check and not args.tiles)) else args.tiles
    if not names:
        ap.error("give a tile, --all, or --check")

    if args.check:
        bad = 0
        have_sun = have_fog = 0
        for t in names:
            path = os.path.join(WORLD, t, "light.json")
            if not os.path.exists(path):
                print("FAIL %s: light.json missing" % t)
                bad += 1
                continue
            with open(path) as fh:
                on_disk = json.load(fh)
            if on_disk != extract(t):
                print("FAIL %s: stale" % t)
                bad += 1
                continue
            if on_disk.get("sun"):
                have_sun += 1
            if (on_disk.get("fog") or {}).get("end") is not None:
                have_fog += 1
        print("check: %d tiles, %d with a sun, %d with fog, %d bad"
              % (len(names), have_sun, have_fog, bad))
        return 1 if bad else 0

    n = suns = 0
    for t in names:
        d = write(t)
        if d is None:
            continue
        n += 1
        if d.get("sun"):
            suns += 1
    print("wrote light.json for %d tiles (%d carry a sun)" % (n, suns))
    return 0


if __name__ == "__main__":
    sys.exit(main())
